import type { AppInfo, TermData, AttendanceCSVRaw, PRNFileInfo, 
	RosterRecord, RosterStatus, SelfServiceCsvExport } from "./types/simpleattendanceTypes.d.ts";

import { readFile, readdir } from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import { parse } from "../node_modules/csv-parse/dist/esm/sync.js";
import { stringify } from "../node_modules/csv-stringify/dist/esm/sync.js";

import { DEBUG_MODE } from "./simpleattendanceNode.js";

export class RosterRecordsManager {
   termData: TermData;
   rosterRecordsPath: string;
   rosterFileNamesRE: RegExp;
   rosterFileNames: string[] = [];
   rostersRecordsHeaders: string[]
	rosterFilesRelpath: string;
	debugRosters: string[] | undefined; // used to debug roster files use

   constructor(appInfo: AppInfo) {
      let termData = appInfo.termsFolderPaths.terms.find((elem: TermData) => elem.term == appInfo.activeTerm)
      if (!termData)
         throw Error("Cannot initialize 'RosterRecordsManager' because active term not found in YAML file");
      this.termData = termData;
      this.rosterRecordsPath = `${this.termData.path}/${appInfo.rosters.filesRelpath}`;
      this.rosterFileNamesRE = new RegExp(appInfo.rosters.fileNamesRE);
      this.rostersRecordsHeaders = appInfo.rosters.recordsHeaders;
		this.rosterFilesRelpath = appInfo.rosters.filesRelpath;
		this.debugRosters = appInfo.debug.rosters;
   }

   getRosterRecordsFolder(): string {
      return this.rosterRecordsPath;
   }

   // gets a list of all the file names
   async getRosterFilesNames(verbose?: boolean): Promise<string[]> {
		if (verbose && verbose == true)
			console.log(
				"Searching for roster records in files" + 
				`\n  with name pattern '${this.rosterFileNamesRE}'` +
				`\n  in folder '${this.rosterRecordsPath}/${this.rosterFilesRelpath}'`
			);
	   this.rosterFileNames =  (await readdir(this.rosterRecordsPath)).
               filter(item => item.search(this.rosterFileNamesRE) == 0);
		if (this.rosterFileNames.length == 0)
			throw Error("No roster files were found");
      return this.rosterFileNames;
   }

   // use inquirer to select files
   async selectRosterFiles(rosterFileNames: string[]): Promise<PRNFileInfo[]> {
		const rosterFileData = await this.getRosterFileData(rosterFileNames);
		const rosterPrompt = inquirer.createPromptModule();
		const rosterInquirerQuestions = [  
			{
				type: "checkbox",
				name: "rosterSelection",
				message: "Select which roster files to use",
				choices: rosterFileData.map(fileInfo => {
					// Format as a single, clean line to prevent Inquirer rendering bugs
					const label = `[${fileInfo.datetime.toLocaleDateString()}] ` +
							`Sec: ${fileInfo.section} | ` +
							`Cap: ${fileInfo.size.capacity} | ` +
							`Enr: ${fileInfo.size.enrolled} | ` +
							`Wait: ${fileInfo.size.waitlisted}`;
					return {
						name: label,
						value: fileInfo, // This returns the whole object when selected
						short: `Date: ${fileInfo.datetime.toLocaleDateString()}, Section ${fileInfo.section}` // Shown after the user hits Enter
					};
				}),	
				default: () => {
					if (rosterFileData.length === 0) return [];
					
					const latestDateStr = rosterFileData[0].datetime.toLocaleDateString();
					
					// Return the actual fileInfo objects for all matching the first date
					return rosterFileData.filter(f => 
						f.datetime.toLocaleDateString() === latestDateStr
					);
				},
				pageSize: 10,
			}
		];
		let selectedRosters: PRNFileInfo[] = [];
		if (DEBUG_MODE == true) { 
			if (this.debugRosters && this.debugRosters.length > 0) {
				let found;
				for (const debugRoster of this.debugRosters)
					if (found = rosterFileData.find(elem => path.basename(elem.fileNameFullPath) == debugRoster))
						selectedRosters.push(found);
			} else
				selectedRosters = [ rosterFileData[0], rosterFileData[1] ];
			console.log(`In DEBUG_MODE\n  roster files used:` + 
				`\n    ${selectedRosters.map(elem => path.basename(elem.fileNameFullPath)).join("\n    ")}`);
		} else {
			const inquirerSetup = await rosterPrompt(rosterInquirerQuestions);
			selectedRosters = inquirerSetup.rosterSelection;
		}
		return selectedRosters;
   }

	async getRosterFileData(fileNames: string[]): Promise<PRNFileInfo[]> {
		let rosterFiles: PRNFileInfo[] = [];
		for (const rosterFileName of fileNames)
			if (rosterFileName.search(/\.prn$/i) >= 0) { // USE THE SECTION ROSTER tool on SCCCD Dashboard 
				//console.log(`Opening file '${rosterFileName}'`);
				const rosterPRNFileFullPath = `${this.rosterRecordsPath}/${rosterFileName}`;
				const prnFileContent: string[] = (await readFile(rosterPRNFileFullPath)).toString().replace(/\r/g, "").split("\n");
				const rosterPRNFileInfo = this.#parseRosterPRNFile(prnFileContent);
				rosterPRNFileInfo.fileNameFullPath = rosterPRNFileFullPath;
				rosterFiles.push(rosterPRNFileInfo);
			}
		// sort roster file collection by date of read
		rosterFiles.sort((a: PRNFileInfo, b: PRNFileInfo) => {
			return a.datetime > b.datetime ? 1 : a.datetime < b.datetime ? -1 : 0;
		});
		return rosterFiles.reverse(); // put recent dates as first elements
		// inquirer API info: https://www.npmjs.com/package/inquirer
	}

	#parseRosterPRNFile(prnFileContent: string[]): PRNFileInfo {
		let line = 0,
			parts: string[] | null;
		const prnFileInfo: PRNFileInfo = {
			fileNameFullPath: "",
			datetime: new Date(),
			section: -1,
			term: "",
			size: {capacity: -1, enrolled: -1, waitlisted: -1},
			students: {
				enrolled: [],
				waitlisted: [],
				dropped: []
			}
		};

		if ((parts = prnFileContent[line++].match(/Printed on: (.*(AM|PM))/) as string[] | null) != null)
			prnFileInfo.datetime = new Date(parts[1]);
		try {
			if ((parts = prnFileContent[line++].match(/CHEM-3A-(\d{5})[^\d]+(\d{4}(SP|FA))/) as string[] | null) == null)
				throw Error("No section number found when expected");
		} catch (exc) {
			Promise.reject(exc);
		}
		prnFileInfo.section = parseInt(parts![1]);
		prnFileInfo.term = parts![2];
		if ((parts = prnFileContent[line++].match(/Capacity\s*:\s*(\d{1,2})\s+Enrolled\s*:\s*(\d{1,2})\s+Waitlisted\s*:\s*(\d{1,2})/) as string[] | null) != null) {
			prnFileInfo.size.capacity = parseInt(parts[1]);
			prnFileInfo.size.enrolled = parseInt(parts[2]);
			prnFileInfo.size.waitlisted = parseInt(parts[3]);
		}
		while (prnFileContent[line++].search(/NameIDEmail/) < 0)
			;
		let lineText: string,
			rowRegex = /^(\d+)(.+?)(\d{7})([A-Za-z0-9]+@MY\.SCCCD\.EDU)(Enrolled).*$/;
	/*   while (prnFileContent[line]) {
			console.log(`line ${line}: ${prnFileContent[line]}`);
			line++;
			if (!prnFileContent[line]) {
				console.log("next line undefined")
			} else if (prnFileContent[line].search(/Waitlist/) >= 0) {
				console.log("'Waitlist' next line, breaking");
				break;
			}
		} */
		while ((lineText = prnFileContent[line++]).search(/Waitlist$|Dropped$/) < 0)  {
			if ((parts = lineText.match(rowRegex)) == null)
				continue;
	//      if (lineText.search(/Dropped/) >= 0)
	//        break;
			prnFileInfo.students.enrolled.push({
				position: parseInt(parts[1]),
				name: parts[2],
				studentId: parts[3],
				email: parts[4],
				status: parts[5] as RosterStatus
			});
		}
		if (lineText.search(/Waitlist/) >= 0) {
			rowRegex = /^(\d+)(.+?)(\d{7})([A-Za-z0-9]+@MY\.SCCCD\.EDU)(Waitlisted).*$/;
			while ((lineText = prnFileContent[line++]).search(/Dropped$/) < 0)  {
				if ((parts = lineText.match(rowRegex)) == null)
					continue;
				prnFileInfo.students.waitlisted.push({
					position: parseInt(parts[1]),
					name: parts[2],
					studentId: parts[3],
					email: parts[4],
					status: parts[5] as RosterStatus
				});
			}
		}
		rowRegex = /^(\d+)(.+?)(\d{7})([A-Za-z0-9]+@MY\.SCCCD\.EDU)(Dropped).*$/;
			while (lineText = prnFileContent[line++])  {
				if ((parts = lineText.match(rowRegex)) == null)
					continue;
			prnFileInfo.students.dropped.push({
				position: parseInt(parts[1]),
				name: parts[2],
				studentId: parts[3],
				email: parts[4],
				status: parts[5] as RosterStatus
			});
		}
		return prnFileInfo;
	}

	convertPRNFileInfo2RosterRecords(prnFileInfo: PRNFileInfo): RosterRecord[] {
		const rosterRecords: RosterRecord[] = [];
		for (const student of prnFileInfo.students.enrolled)
			rosterRecords.push({
				Section: prnFileInfo.section,
				Name: student.name,
				StudentId: student.studentId,
				Email: student.email,
				Status: student.status,
				"Wait Position": NaN
			});
		for (const student of prnFileInfo.students.waitlisted)
			rosterRecords.push({
				Section: prnFileInfo.section,
				Name: student.name,
				StudentId: student.studentId,
				Email: student.email,
				Status: student.status,
				"Wait Position": student.position
			});
		for (const student of prnFileInfo.students.dropped)
			rosterRecords.push({
				Section: prnFileInfo.section,
				Name: student.name,
				StudentId: student.studentId,
				Email: student.email,
				Status: student.status,
				"Wait Position": NaN
			});
		return rosterRecords;
	}

	#parseCSVRoster(
		rosterContent: string,
		csvFileName?: string
	): RosterRecord[] | null {
		let headers: string = "";
		const rosterRecords: RosterRecord[] | SelfServiceCsvExport[] = parse(rosterContent, {
			bom: true,
			columns: (header: any) => {
				headers += `${header},`;
				return header.map((h: string) => h.trim());
			},
			skip_empty_lines: true,
			cast: (value: string, context: any) => {
				if (context.column == "StudentId")
					return value.length == 6 ? "0" + value : value;
				else if (context.column == "Wait Position")
					return parseInt(value);
				return value;
			}
		});
		let modifiedRosterRecords: RosterRecord[] = [];
		const selfServiceCsvExport: SelfServiceCsvExport[] = rosterRecords as SelfServiceCsvExport[];
		if (rosterContent.search(/Section/) < 0)
			if (csvFileName) {
				let sectionNumberMatchArray = csvFileName.match(/[^\d](\d{5})[^\d]/);
				if (!sectionNumberMatchArray)
					return null;
				const sectionNumber = Number(sectionNumberMatchArray[1]);
				for (const record of selfServiceCsvExport)
					modifiedRosterRecords.push({
						Section: sectionNumber,
						Name: record["Student Name"],
						StudentId: record["Student ID"],
						Email: record["Preferred Email"],
						Status: "Enrolled",
						"Wait Position": -1
					});
			} else
				return null;
		else
			modifiedRosterRecords = rosterRecords as RosterRecord[];
		return modifiedRosterRecords;
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

   // verify an attendance file is an attendance file: it must be contents of file
   verifyRosterFile(fileContent: string | string[]): boolean {
      let input: string[];
      if (typeof fileContent == "string")
         input = fileContent.replace(/\r/g, "").split(",");
      else
         input = fileContent;
		input = input.sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
		const sortedHeaders = this.rostersRecordsHeaders.sort(
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
// check for roster CSV files in zip form: 1) extract, and add DateModified to file name
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
		//RosterFilePath = "D:\\Mavigozler GitHub\\mavigozler.github.io\\Teaching\\Chemistry\\Fall 2025 3A\\Attendance\\Section Rosters Week 3.csv";

		attendanceRecords = await collectAttendanceRecords();
	} catch (exc) {
		console.log(`\n\nProcessing halted: ${exc}\n`);
	} */

}