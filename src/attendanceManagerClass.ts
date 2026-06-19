import { readFile, readdir, writeFile, copyFile } from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import yaml from "js-yaml";
import { parse } from "../node_modules/csv-parse/dist/esm/sync.js";
import { stringify } from "../node_modules/csv-stringify/dist/esm/sync.js";

import type { AppInfo, TermData, AttendanceCSVRaw, AttendanceCabinet, 
	YamlCode
} from "./types/simpleattendanceTypes.d.ts";

/********************************************************
 *   Works with YAML file 'appinfo' and its config info
 ********************************************************/


export class AttendanceRecordsManager {
   termData: TermData;
   attendanceRecordsPath: string;
   attendanceFileNamesRE: RegExp;
   attendanceFileNames: string[] = [];
   codesUsed: YamlCode[];
   attendanceRecordsHeaders: string[]

   constructor(appInfo: AppInfo) {
      let termData = appInfo.termsFolderPaths.terms.find((elem: TermData) => elem.term == appInfo.activeTerm)
      if (!termData)
         throw Error("Cannot initialize 'AttendanceRecordsManager' because active term not found in YAML file");
      this.termData = termData;
      if ((this.attendanceRecordsPath = `${this.termData.path}/${appInfo.attendance.filesRelpath}`) == undefined)
			throw Error("Cannot find 'filesRelPath' in appInfo YAML configuration");
      this.attendanceFileNamesRE = new RegExp(appInfo.attendance.fileNamesRE);
      this.codesUsed = appInfo.codesUsed;
      this.attendanceRecordsHeaders = appInfo.attendance.recordsHeaders;
   }

   getAttendanceRecordsFolder(): string {
      return this.attendanceRecordsPath;
   }

   // gets a list of all the file names
   async getRecordsFilesNames(): Promise<string[]> {
	   this.attendanceFileNames =  (await readdir(this.attendanceRecordsPath)).
               filter(item => item.search(this.attendanceFileNamesRE) == 0);
      return this.attendanceFileNames;
   }

   // get the records in an attendance file as string[]
   async getRecords(attendanceRecordsFileNames: string[]): Promise<AttendanceCabinet> {
      let attendanceCabinet: AttendanceCabinet = {
			drawers: []
		};
      for (const attendanceFileName of attendanceRecordsFileNames)
         attendanceCabinet.drawers.push({
				records: (await readFile(`${this.attendanceRecordsPath}/${attendanceFileName}`, 'utf8')).replace(/\r/g,"").split("\n"),
				fileName: attendanceFileName
			});
      return attendanceCabinet;
   }

   // use inquirer to select files
   async selectRecordsFiles(): Promise<string[]> {
      const attendanceRecordsPrompt = inquirer.createPromptModule();
	   const attendanceRecordsInquirerQuestions = [  
		   {
            type: "checkbox",
            name: "attendanceRecordsSelection",
            message: "Select which attendance records to use",
            choices: this.attendanceFileNames.reverse(),
            default: [ this.attendanceFileNames[0] ],
            pageSize: 12
         }
      ];
      const inquirerSetup = await attendanceRecordsPrompt(attendanceRecordsInquirerQuestions);
      return inquirerSetup.attendanceRecordsSelection;
   }

   // 
   convertCSVToObject(csv: string | string[]): AttendanceCSVRaw[] {
      let rawSessionRecords: AttendanceCSVRaw[] = [];
      let input: string;
      if (typeof csv == "string")
         input = csv;
      else
         input = (csv as string[]).join("\n")
      rawSessionRecords = rawSessionRecords.concat(parse(input, {
         columns: true,
         relaxQuotes: true,
         relax_column_count: true,
         skip_empty_lines: true
      }).map((elem: AttendanceCSVRaw) => {
			elem["Attendance Code"] = elem["Attendance Code"].replace(/ /g, "").toUpperCase();
			return elem;
		}));
      return rawSessionRecords;
   }

   // add all attendance codes to YAML file.
   async updateCodesToYAML(pathToYAML: string) {
      // get all the attendance records and get attendance code
      const attendanceFilesNames = await this.getRecordsFilesNames();
      const attendanceCabinet = await this.getRecords(attendanceFilesNames);
      // set up the arrays
      let collectedRecords: AttendanceCSVRaw[] = [];
      for (const drawer of attendanceCabinet.drawers)
			if (this.verifyAttendanceFile(
            		AttendanceRecordsManager.manageCSVQuotedValues(drawer.records[0], true)
					) == false)
         	console.log(`file '${path.basename(drawer.fileName)}' does not indicate it is an attendance records file`);
			else
         	collectedRecords = collectedRecords.concat(this.convertCSVToObject(drawer.records));
		// make Set of attendance codes
		const dateattcodeRecord: string[] = [];
		for (const record of collectedRecords)
			dateattcodeRecord.push(JSON.stringify({
				date: record.Timestamp.match(/\d{4}\/\d{2}\/\d{2}/)![0],
				code: record["Attendance Code"]
			}));
		const unique = [...new Set(dateattcodeRecord)];
		const yamlObjects: YamlCode[] = [];
		let datecode: {date:string;code:string;},
			found: YamlCode | undefined;
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
	   const appInfo: AppInfo = yaml.load(yamlFile) as AppInfo;
		appInfo.codesUsed = yamlObjects;
		await copyFile(pathToYAML, `${path.dirname(pathToYAML)}/` + 
				`${path.basename(pathToYAML, path.extname(pathToYAML))}-backup.${path.extname(pathToYAML)}`)
		await writeFile(pathToYAML, yaml.dump(appInfo));
   }
   // verify an attendance file is an attendance file: it must be contents of file
   verifyAttendanceFile(fileContent: string | string[]): boolean {
      let input: string[];
      if (typeof fileContent == "string")
         input = fileContent.replace(/\r/g, "").split(",");
      else
         input = fileContent;
		input = input.sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
		const sortedHeaders = this.attendanceRecordsHeaders.sort(
			(a, b) => a > b ? 1 : a < b ? -1 : 0
		);
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

	static manageCSVQuotedValues<T extends string | string[]>(csvContent: T, quoting: boolean = true): T {
   	const isInputString = typeof csvContent === "string";
    	// Normalize 
		// input to a string for the parser
		const input = isInputString ? csvContent : (csvContent as string[]).join("\n");
		// Process using csv-lib
		// Note: quote: false tells stringify to only quote if necessary, 
		// but usually, we use the 'quote' option to force or suppress.
		const processed = stringify(parse(input), {
			quoted: quoting,
			record_delimiter: '\n'
		}).trim(); // trim to avoid trailing newline issues
		// Return the same type as the input
		if (isInputString)
			return processed as T;
		return processed.split("\n") as T;
	}
   
// ZIP file extraction 
// check for Attendance CSV files in zip form: 1) extract, and add DateModified to file name
	/*
	try {
		const zipFiles = await glob(`${downloadsFolder}/*.zip`);
		if (zipFiles.length > 0)
			for (const zipFile of zipFiles)
				if (zipFile.search(attendanceFileNamesRE) > 0)
					new AdmZip(zipFile).extractAllTo(downloadsFolder, false);
	} catch (exc) {
		throw Error(`error extracting an attendance zip file to '${downloadsFolder}':\n${exc}`);
	}

	try {
		const files = await glob([`${downloadsFolder}/*.csv`, `${downloadsFolder}/*.prn`]);
		if (existsSync(AttendanceRecordsFolder) == false)
			await mkdirp(AttendanceRecordsFolder);
		for (const file of files) {
			await copyFile(file, `${AttendanceRecordsFolder}/${path.basename(file)}`);
			unlink(file, (err) => {
				if (err)
					console.log(`Error deleting *.csv files:\n${err}`);
			});
		}
	} catch (exc) {
		console.log("Failure to execute `unlink` method");
		throw Error("Copy and delete operations failed")
	} */

//  GUI file dialog use

/*
	try {
		rosterFiles = await openFileDialog(
			'Select Student Roster CSV and/or PRN Files',  // dialogTitle
			'CSV, PRN files (*.csv; *.prn)|*.csv;*.prn|All files (*.*)|*.*', // file types filter string
			AttendanceRecordsFolder
		);
		//RosterFilePath = "D:\\ProfMitch Github\\profmitch.github.io\\Teaching\\Chemistry\\Fall 2025 3A\\Attendance\\Section Rosters Week 3.csv";

		attendanceRecords = await collectAttendanceRecords();
	} catch (exc) {
		console.log(`\n\nProcessing halted: ${exc}\n`);
	} */

}