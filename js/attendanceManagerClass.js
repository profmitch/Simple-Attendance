import { readFile, readdir, writeFile, copyFile } from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import yaml from "js-yaml";
import { parse } from "../node_modules/csv-parse/dist/esm/sync.js";
import { stringify } from "../node_modules/csv-stringify/dist/esm/sync.js";
export class AttendanceRecordsManager {
    termData;
    attendanceRecordsPath;
    attendanceFileNamesRE;
    attendanceFileNames = [];
    codesUsed;
    attendanceRecordsHeaders;
    constructor(appInfo) {
        let termData = appInfo.termsFolderPaths.terms.find((elem) => elem.term == appInfo.activeTerm);
        if (!termData)
            throw Error("Cannot initialize 'AttendanceRecordsManager' because active term not found in YAML file");
        this.termData = termData;
        this.attendanceRecordsPath = `${this.termData.path}/${appInfo.attendance.filesRelpath}`;
        this.attendanceFileNamesRE = new RegExp(appInfo.attendance.fileNamesRE);
        this.codesUsed = appInfo.codesUsed;
        this.attendanceRecordsHeaders = appInfo.attendance.recordsHeaders;
    }
    getAttendanceRecordsFolder() {
        return this.attendanceRecordsPath;
    }
    // gets a list of all the file names
    async getRecordsFilesNames() {
        this.attendanceFileNames = (await readdir(this.attendanceRecordsPath)).
            filter(item => item.search(this.attendanceFileNamesRE) == 0);
        return this.attendanceFileNames;
    }
    // get the records in an attendance file as string[]
    async getRecords(attendanceRecordsFileNames) {
        let attendanceCabinet = {
            drawers: []
        };
        for (const attendanceFileName of attendanceRecordsFileNames)
            attendanceCabinet.drawers.push({
                records: (await readFile(`${this.attendanceRecordsPath}/${attendanceFileName}`, 'utf8')).replace(/\r/g, "").split("\n"),
                fileName: attendanceFileName
            });
        return attendanceCabinet;
    }
    // use inquirer to select files
    async selectRecordsFiles() {
        const attendanceRecordsPrompt = inquirer.createPromptModule();
        const attendanceRecordsInquirerQuestions = [
            {
                type: "checkbox",
                name: "attendanceRecordsSelection",
                message: "Select which attendance records to use",
                choices: this.attendanceFileNames.reverse(),
                default: [this.attendanceFileNames[0]],
                pageSize: 12
            }
        ];
        const inquirerSetup = await attendanceRecordsPrompt(attendanceRecordsInquirerQuestions);
        return inquirerSetup.attendanceRecordsSelection;
    }
    // 
    convertCSVToObject(csv) {
        let rawSessionRecords = [];
        let input;
        if (typeof csv == "string")
            input = csv;
        else
            input = csv.join("\n");
        rawSessionRecords = rawSessionRecords.concat(parse(input, {
            columns: true,
            relaxQuotes: true,
            relax_column_count: true,
            skip_empty_lines: true
        }).map((elem) => {
            elem["Attendance Code"] = elem["Attendance Code"].replace(/ /g, "").toUpperCase();
            return elem;
        }));
        return rawSessionRecords;
    }
    // add all attendance codes to YAML file.
    async updateCodesToYAML(pathToYAML) {
        // get all the attendance records and get attendance code
        const attendanceFilesNames = await this.getRecordsFilesNames();
        const attendanceCabinet = await this.getRecords(attendanceFilesNames);
        // set up the arrays
        let collectedRecords = [];
        for (const drawer of attendanceCabinet.drawers)
            if (this.verifyAttendanceFile(AttendanceRecordsManager.manageCSVQuotedValues(drawer.records[0], true)) == false)
                console.log(`file '${path.basename(drawer.fileName)}' does not indicate it is an attendance records file`);
            else
                collectedRecords = collectedRecords.concat(this.convertCSVToObject(drawer.records));
        // make Set of attendance codes
        const dateattcodeRecord = [];
        for (const record of collectedRecords)
            dateattcodeRecord.push(JSON.stringify({
                date: record.Timestamp.match(/\d{4}\/\d{2}\/\d{2}/)[0],
                code: record["Attendance Code"]
            }));
        const unique = [...new Set(dateattcodeRecord)];
        const yamlObjects = [];
        let datecode, found;
        for (const asString of unique) {
            datecode = JSON.parse(asString);
            if (found = yamlObjects.find(elem => elem.date === datecode.date))
                if (datecode.code.search(/LEC/) > 0)
                    found.lecture = datecode.code;
                else
                    found.lab = datecode.code;
            else if (datecode.code.search(/LEC/) > 0)
                yamlObjects.push({
                    date: datecode.date,
                    lecture: datecode.code,
                    lab: ""
                });
            else
                yamlObjects.push({
                    date: datecode.date,
                    lecture: "",
                    lab: datecode.code
                });
        }
        //	for (const item of unique)
        const yamlFile = await readFile(pathToYAML, "utf8");
        const appInfo = yaml.load(yamlFile);
        appInfo.codesUsed = yamlObjects;
        await copyFile(pathToYAML, `${path.dirname(pathToYAML)}/` +
            `${path.basename(pathToYAML, path.extname(pathToYAML))}-backup.${path.extname(pathToYAML)}`);
        await writeFile(pathToYAML, yaml.dump(appInfo));
    }
    // verify an attendance file is an attendance file: it must be contents of file
    verifyAttendanceFile(fileContent) {
        let input;
        if (typeof fileContent == "string")
            input = fileContent.replace(/\r/g, "").split(",");
        else
            input = fileContent;
        input = input.sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
        const sortedHeaders = this.attendanceRecordsHeaders.sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
        if (sortedHeaders.every((value, index) => value === input[index]) == true)
            return true;
        console.log(sortedHeaders.map((value, comparedRow) => ({
            comparedRow: comparedRow + 1,
            yamlSpec: value,
            csvFile: input[comparedRow]
        })).filter(item => item.yamlSpec !== item.csvFile));
        return false;
    }
    /*   static manageCSVQuotedValues(csvContent: string | string[], quoting?: boolean): string {
          let isString: boolean = true,
             input: string;
          quoting = quoting ?? true;
          if (typeof csvContent == "string")
             input = csvContent;
          else {
             input = csvContent.join("\n");
             isString = false;
          }
          return stringify(parse(input), {quote: quoting == true ? '"' : false});
       } */
    static manageCSVQuotedValues(csvContent, quoting = true) {
        const isInputString = typeof csvContent === "string";
        // Normalize 
        // input to a string for the parser
        const input = isInputString ? csvContent : csvContent.join("\n");
        // Process using csv-lib
        // Note: quote: false tells stringify to only quote if necessary, 
        // but usually, we use the 'quote' option to force or suppress.
        const processed = stringify(parse(input), {
            quoted: quoting,
            record_delimiter: '\n'
        }).trim(); // trim to avoid trailing newline issues
        // Return the same type as the input
        if (isInputString)
            return processed;
        return processed.split("\n");
    }
}
//# sourceMappingURL=attendanceManagerClass.js.map