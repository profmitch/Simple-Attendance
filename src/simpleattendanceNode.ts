import type { AppInfo, SessionReport, AttendanceCabinet, RosterRecord, RosterCabinet} from "./types/simpleattendanceTypes.js";

import { readFile, writeFile 
//	copyFile 
} from "fs/promises";
//import { glob } from "glob";
//import { mkdirp } from "mkdirp";
import columnify from "columnify";
import yaml from "js-yaml";
//import {openFileDialog, folderBrowserDialog, saveFileDialog} from  "./iPowerShell.js";

import { deduplicateByField, multiSort } from "./GenLib/arraysExtended.js";
//import blessed, { line, text } from "blessed";
import { coreProcessing	} from "./simpleattendanceCore.js";
import { existsSync } from "fs";
import { stringify } from "../node_modules/csv-stringify/dist/esm/index.js";
import { AttendanceRecordsManager } from "./attendanceManagerClass.js";
import { RosterRecordsManager } from "./rosterManagerClass.js";
//import AdmZip from "adm-zip";

// import type { SessionData } from "./types/simpleattendanceTypes.d.ts";
//let AttendanceRecordsFolder: string;

let AttendanceManager: AttendanceRecordsManager,
	RosterManager: RosterRecordsManager;

export const DEBUG_MODE = 
		(process.env && process.env.NODE_ENV) ? 
		process.env.NODE_ENV === 'development' :
		false;


const PresentColumnsOrdering = [
		"Name", "StudentID", "Section", "Timestamp", "SessionType", "WaitlistPosition"
	],
	AbsentColumnsOrdering = [
		"Name", "StudentID", "Email", "Section", "SessionType", "WaitlistPosition"
	],
	UnmatchedColumnsOrdering = [
		"StudentID", "RecordedName", "TimeStamp", "SessionType"
	];

	
/*
async function collectAttendanceRecords(): Promise<string[]> {
	/*
	DEBUGGING: 
	const recordsFolder = await folderBrowserDialog(
		'Select folder containing attendance records CSV files',
		AttendanceRecordsFolder,
		true
	); 
	const recordsFolder = "D:\\ProfMitch Github\\profmitch.github.io\\Teaching\\Chemistry\\Fall 2025 3A\\Attendance";

	const folderFiles = (await readdir(recordsFolder)).filter(item => item.search(/^Attendance\d{8}.csv$/i) == 0);
	AttendanceSessionFiles = folderFiles;
	const openedFiles: Promise<string>[] = [];
	for (const file of folderFiles)
		if (file.search(/^Attendance\d{8}\.csv$/) >= 0)
			openedFiles.push(new Promise<string>((resolve, reject) => {
				(async () => {
					try {
						resolve(await readFile(path.join(recordsFolder, file), { encoding: "utf8"}));
					} catch (except) {
						reject(`Error: ${except}`);
					}
				})();
			}));
	return Promise.all(openedFiles)
	.then((records: string[]) => {
		return records;
	}).catch(err => { return err });
} */

async function collectFiles(
	appInfo: AppInfo
): Promise<{ rosterCabinet: RosterCabinet, attendanceCabinet: AttendanceCabinet}>  {
	/* Roster files name formats are specified as REs in YAML file
	  1. "section-rosters_CHEM-3A-(\\d+)_.*\\.csv"-- name from FCC Self-service
	      Section are found from file name
	  2. "Chem3a-?\\d{5}\\s+roster.*\\.prn"
	    obtained from FCC Section Roster utility using Print to FILE: 
		 used to generate waitlist initially

		This code will first check the Downloads folder for roster files and move them to their 
		final location

		must read section roster CSV records and preserve them for core processing
		The waitlist records must be merged as well if used
		When finished, it will be one file with section numbers added to the records
	Attendance records will be unchanged.	
	*/
	const attendanceRecordsFolder = AttendanceManager.getAttendanceRecordsFolder();//
	//	rosterRecordsFolder = RosterManager.getRosterRecordsFolder();

	let selectedRosters = await RosterManager.selectRosterFiles(
		await RosterManager.getRosterFilesNames()
	);

/*
		} else {
			let csvRecords: RosterRecord[] | null;
			const rosterFileContent = await readFile(`${AttendanceRecordsFolder}/${rosterFileName}`, 'utf8');
			if (csvRecords = parseCSVRoster(rosterFileContent, rosterFileName))
				rosterRecords = rosterRecords.concat(csvRecords);
			else
				console.log(`There was an error in parsing roster file '${rosterFileName}'`);
		}
*/
	let rosterRecords: RosterRecord[] = [];
	for (const selectedRoster of selectedRosters)
		rosterRecords = rosterRecords.concat(RosterManager.convertPRNFileInfo2RosterRecords(selectedRoster));
	rosterRecords = deduplicateByField(rosterRecords, "StudentId");
	const rosterCabinet: RosterCabinet = {
		fileNames: selectedRosters.map(elem => elem.fileNameFullPath),
		records: rosterRecords
	};
	rosterCabinet.records = multiSort(
		rosterCabinet.records, 
			[
				{ key: "Section"},
				{ key: "Name" }      
			]
		);
	const enrolled = rosterCabinet.records.filter(elem => elem.Status == "Enrolled");
	try {
//  roster file creation reports/CSV file
		const today = new Date();
		let rosterFileReport = `Roster File Report for ${today.toLocaleDateString()}\n`;
		rosterFileReport += columnify(enrolled, 
			{ columns: [ "StudentId", "Name", "Section", "Email" ] }
		);
		const rosterReportFileName = `${appInfo.termsFolderPaths.downloadsFolder}\\RosterReport-${today.getFullYear()}` +
				`${(today.getMonth() + 1).toString().padStart(2, "0")}` + 
				`${(today.getDate().toString().padStart(2, "0"))}.txt`;
		await writeFile(rosterReportFileName, rosterFileReport, "utf8");
		console.log(`Roster report '${rosterReportFileName}' successfully written to '${appInfo.termsFolderPaths.downloadsFolder}'`);
		stringify(enrolled, 
			{ columns: [ "Section", "Name", "StudentId" , "Email" ],
				header: true }, 	
				(err: any, rosterFilesCSV: string | import("stream") | NodeJS.ArrayBufferView<ArrayBufferLike> | Iterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>> | AsyncIterable<string | NodeJS.ArrayBufferView<ArrayBufferLike>>) => {
			if (err)
				throw err;
			(async () => {
				const rosterCSVFilename = `${appInfo.termsFolderPaths.downloadsFolder}\\Roster-${today.getFullYear()}` +
						`${(today.getMonth() + 1).toString().padStart(2, "0")}` + 
						`${(today.getDate().toString().padStart(2, "0"))}.csv`;
				await writeFile(rosterCSVFilename, rosterFilesCSV, "utf8");
				console.log(`Roster CSV file '${rosterCSVFilename}' successfully written to '${appInfo.termsFolderPaths.downloadsFolder}'`)
			})();
		});
//		let rosterFilesCSV = "StudentID,Name,Section,Email";
//		for (const rec of enrolled)
//			rosterFilesCSV += `\n${rec.StudentId},${rec.Name},${rec.Section},${rec.Email}`;
	} catch (exc) {
		console.error(`Error writing roster report files:\n  errmsg: ${exc}`);
	}

	console.log(
		"Searching for attendance records in files" + 
		`\n  with name pattern '/${appInfo.attendance.fileNamesRE}/'` +
		`\n  in folder '${attendanceRecordsFolder}/${appInfo.attendance.filesRelpath}'`
	);

	let selectedAttendance: string[] ;
	if (DEBUG_MODE == true && // set DEBUG MODE at top of file
			appInfo.debug.attendance && appInfo.debug.attendance.length > 0)
		selectedAttendance = appInfo.debug.attendance;
//		else
//			selectedAttendance = attendanceFileNames;
//		console.log(`In DEBUG_MODE\n  attendance files: ${selectedAttendance.join("\n  ")}`);
	else
		selectedAttendance = await AttendanceManager.selectRecordsFiles();
	
	const attendanceCabinet = await AttendanceManager.getRecords(selectedAttendance);
	//	await fileDialog("D:\\Documents\\PowerShell\\saveFileDialog.ps1");
	return {rosterCabinet, attendanceCabinet};
}

async function createReport(appInfo: AppInfo, sessionReport: SessionReport) {
	const today: Date = new Date();
	let report = `ATTENDANCE REPORT for ${appInfo.courseName}` +
		"\nGenerated:  " + today.toLocaleDateString();
	report += "\n\nfiles used to generate this report\nRoster Records:\n\n";
	report += "Roster Files:\n   " + sessionReport.fileNames.rosters.join("\n   ");
	report += "\n\nAttendance Records:\n   " + sessionReport.fileNames.attendance.join("\n   ");
	for (const sessionData of sessionReport.sessions) {
		// sort by name 
		report += "\n\n======================================================================================" +
			`\nSession Code: ${sessionData.SessionCode}` +
			`\nSession Date: ${sessionData.SessionDate}` +
			`\nSession Type: ${sessionData.SessionType}` +
			"\n----" +
			`\n\n------ UNMATCHED PRESENT   (count = ${sessionData.Unmatched.length})\n` +
			(sessionData.Unmatched.length == 0 ? "--NONE--" : 
				columnify(sessionData.Unmatched, { columns: UnmatchedColumnsOrdering })) +
			`\n\n------ ABSENT   (count = ${sessionData.Absent.length})\n` +
			(sessionData.Absent.length == 0 ? "--NONE--" : 
				columnify(sessionData.Absent, { columns: AbsentColumnsOrdering })) +
			`\n\n------ PRESENT   (count = ${sessionData.Present.length})\n` +
				columnify(sessionData.Present, { columns: PresentColumnsOrdering }) + "\n\n" ;
	}
//	report += //`\n\nRoster file path: ${RosterFilePath}` +
//		`\nAttendance records folder: ${AttendanceRecordsFolder!}` +
//		`\nAttendance records files:\n${AttendanceSessionFiles!.join("\n  ")}`;
	const dateString = (date: Date) => {
		return `${date.getFullYear()}-${(date.getMonth() + 1).toString()}-` +
				`${date.getDate().toString().padStart(2, "0")}`;
	};
	let termInfo: { term: string; sections: {day: string, number: number }[]; path: string;} | undefined = 
				appInfo.termsFolderPaths.terms.find(elem => elem.term == appInfo.activeTerm),
		writePath: string;
	if (termInfo && termInfo.path)  {
		writePath = `${termInfo.path}/${appInfo.reports.relpath}/${appInfo.reports.fileNameFormat}`;
		if (writePath.search("YYYYMMDD") >= 0)
			writePath = writePath.replace("YYYYMMDD", dateString(new Date()));
		let fileNum: number = 1;
		do {
			writePath = writePath.replace(/(#NN|#\d{2})/, `#${fileNum.toString().padStart(2, "0")}`);
			fileNum++;
		} while (existsSync(writePath) == true);
		try {
			await writeFile(writePath, report, "utf8");
			console.log(`File written to '${writePath}'`)
		} catch (exc) {
			console.error(`Error writing file '${writePath}' for attendance:\nErrmsg ${exc}`);
		}
	}
	/*
	const maxRetries = 3;
   let currentRetry = 0,
		success = false;
	
	const saveResult = await saveFileDialog(
		"Save Attendance Report as...",
		`Attendance Report-${setFileDating(fileNum)}.txt`,
		"TXT files (*.txt)|*.txt|All files (*.*)|*.*",
		AttendanceRecordsFolder
	);
	
	while (!success && currentRetry < maxRetries)
		try {
			await writeFile(
				saveResult, 
				report, 
				{flag: "wx"} 
			);
			success = true;
			//	resolve(csvData);
		} catch (exc) {
			currentRetry++;
			//	reject(`An exception occurred: ${exc}`);	
		}*/
}

/**
 * options: 
 */
async function entry(options?: string[]) {
	/* Should not have to use this 
		const yamlFileName = await openFileDialog(
			'Select Course Info YAML File',  // dialogTitle
			"YAML Files (*.yaml;*.yml)|*.yaml;*.yml|All files (*.*)|*.*", // file types filter string
			AttendanceRecordsFolder
		);*/
	const yamlFileName = "../config/SimpleAttendance.yaml";
	const yamlFile = await readFile(yamlFileName, "utf8");
	const appInfo: AppInfo = yaml.load(yamlFile) as AppInfo;
	AttendanceManager = new AttendanceRecordsManager(appInfo);
	RosterManager = new RosterRecordsManager(appInfo);
	if (options && options.find(elem => elem == "updateYaml")) {
		AttendanceManager.updateCodesToYAML(yamlFileName);
		return;
	}
	const dataFiles = await collectFiles(appInfo);
	const {sessionAnalysis
			//, rosterRecords, csvData
	} = 
		/* core processing expects
			1. roster records as a string with CSV style lines
			2. attendance records are an array of strings like roster recordd, each 
			   array element being a string with CSV style lines
		*/
		coreProcessing(appInfo, dataFiles.rosterCabinet, dataFiles.attendanceCabinet);
	const sessionReport = {
		fileNames: {
			rosters: dataFiles.rosterCabinet.fileNames,
			attendance: dataFiles.attendanceCabinet.drawers.map(elem => elem.fileName)
		},
		sessions: sessionAnalysis
	}
	createReport(appInfo, sessionReport);
}

// entry(process.argv.slice(3));
entry();
