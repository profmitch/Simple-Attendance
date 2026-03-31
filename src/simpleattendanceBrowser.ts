import type { SessionData, RosterRecord,  AppInfo,
	AbsenceInfo, AttendanceRecord, UnmatchedRecord} from "./types/simpleattendanceTypes";
import type { ElementCssProperties, TMakeTableParams, TMakeTableOptions
 } from "./GenLib/makeTable.d";

import * as jsYaml from "../node_modules/js-yaml/dist/";

// import { generate } from "../node_modules/csv-generate/dist/esm/sync.js";
import { coreProcessing, setPacificTime } from "./simpleattendanceCore.js";
import { makeTable } from "./GenLib/makeTable.js";
// import { text } from "stream/consumers";

//import { RosterData, AttendanceData } from "./testFileContent.js";
//const timePeriodRE = /(\s*\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?\s*\-\s*\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?,?)+/g;
const TIME_RANGES_EXAMPLE_PLACEHOLDER = [
	{ "12h": "2:15pm-4:50pm", "24h": "14:15-16:50" },  
	{ "12h": "5:00pm-9:30pm", "24h": "17:00-21:30" }
];
const titleCaptionAttribs: ElementCssProperties = {
		fontFamily: "Tahoma,sans-serif",
		fontWeight: "bold",
		color: "blue",
		fontSize: 13,
},
subtitleCaptionAttribs: ElementCssProperties = {
	fontFamily: "Courier,Courier New",
	fontSize: 16
};

	// get the YAML config
const ThisAppInfo: AppInfo = jsYaml.load(await (await fetch("../config/SimpleAttendance.yaml")).text()) as AppInfo;

let rollTableDiv: HTMLDivElement,
	downloadFilesButtonsDiv: HTMLDivElement,
	rosterContent: string,
	warningsDiv = document.getElementById("warnings") as HTMLDivElement,
	SelectList: HTMLDivElement;

/**
 * @function Warning
 * @param message 
 */
function Warning(message: string) {
	const spanElem = document.createElement("span");
	spanElem.appendChild(document.createTextNode(message));
	spanElem.style.display = "block";
	warningsDiv.appendChild(spanElem);
	warningsDiv.style.display = "block";
}

/**
 * 
 */
document.addEventListener("DOMContentLoaded", () => {
	/* build HTML form */
	SelectList = document.getElementById("select-list") as HTMLDivElement;
	document.getElementById("form-reset")?.addEventListener("click", (evt: Event) => {
		(evt.currentTarget as HTMLButtonElement).form!.reset();
		while (SelectList.firstChild)
			SelectList.removeChild(SelectList.firstChild);
	});

	const droppedFiles: File[] = [];
   const rosterFileControl = document.getElementById("roster-file") as HTMLInputElement;
	const rosterFileFormat = ThisAppInfo.rosterFileNamePrompt;
	droppedFilesProcessingInitialization(
		'roster-dropzone', 
		[ { re: ThisAppInfo.rosterFileNamesRE, flag: "i"} ],
		"roster-files-folder-input"
	);
	/*rosterFileControl.addEventListener("change", (evt: Event) => {
		const rosterFile = (evt.currentTarget as HTMLInputElement).files?.[0] ?? undefined;
		if (rosterFile)
			getContentsFromFiles([rosterFile])
			.then(content => rosterContent = content[0])  // get the one file
			.catch(err => {
				Warning(`Roster file upload error: Err=${err}`);
			});
	});*/
/*************************************************************************
 *   Attendance Records Input UI start
 *************************************************************************/
	let attendanceCsvFiles: File[];
	const docgridDiv = document.getElementById("docgrid") as HTMLDivElement,
		mainDiv = document.getElementById("mainbox") as HTMLDivElement,
		mainDivMaxWidth = mainDiv.style.maxWidth;
	const attendanceFileFormat = ThisAppInfo.attendanceFileNamePrompt;
	const spanElem = document.createElement("span");
	spanElem.id = "attendance-file-format-string";
	spanElem.appendChild(document.createTextNode(attendanceFileFormat));
	document.getElementById("attendance-file-format")?.appendChild(spanElem);

	// Attendance DROPPED FILES code
	droppedFilesProcessingInitialization(
		'attendance-dropzone', 
		[ { re: ThisAppInfo.attendanceFileNamesRE, flag: "i"} ],
		"attendance-files-folder-input"
	);

	// CHOOSE FILES input code
/*
   document.getElementById("attendance-files-folder-input")!.addEventListener("change", (evt: Event) => {
		let fileItem: File | null;
		const attendanceFileList = (evt.currentTarget as HTMLInputElement).files ?? undefined;
		// filter to files of *.csv type
		if (attendanceFileList)
			for (let i = 0; fileItem = attendanceFileList.item(i++); fileItem != null)
				droppedFiles.push(fileItem);
			if (droppedFiles.length == 0) {
				document.getElementById("attendance-files-prompt")!.style.display = "none";
				document.getElementById("select-list-report")!.appendChild(
					document.createTextNode(
						"No files were found in the list of files selected. Reset and try again"
					)
				);
			} else
				attendanceCsvFiles = getCsvFilesOnly(droppedFiles);
	}); */
	(document.getElementById("control-time") as HTMLInputElement).addEventListener("change", (evt: Event) => {
		if ((evt.currentTarget as HTMLInputElement).checked == true) {
			docgridDiv.style.display = "grid";
			mainDiv.style.maxWidth = "50em";
			timeControlDiv.style.display = "block";
		} else {
			docgridDiv.style.display = "block";
			mainDiv.style.maxWidth = mainDivMaxWidth;
			timeControlDiv.style.display = "none";
		}
	});
	const timeControlDiv = document.getElementById("right-side") as HTMLDivElement,
		daynameproducer = new Date('2023-01-01T00:00:00'); // starts on Sunday
	timeControlDiv.appendChild(document.createTextNode(
		"Use this optional feature to make sure students record attendance within a proper time window"
	));
	const weekdaysLabelElem = document.createElement("label");
	weekdaysLabelElem.id = "weekdaysLabelElem";
	timeControlDiv.appendChild(weekdaysLabelElem);
	const beforeText = document.createElement("span");
	weekdaysLabelElem.appendChild(beforeText);
	beforeText.appendChild(
		document.createTextNode("Select the days of the week for which attendance records are wanted")
	);
	beforeText.id = "beforeText";
	for (let i = 0; i < 7; i++) {
		const daySpanElem = document.createElement("span");
		timeControlDiv.appendChild(daySpanElem);
		daySpanElem.className = "daySpanElem";
		// for 1st day of week = Monday daynameproducer.setDate(date.getDate() + 1)
		const namedDay = document.createElement("span");
		namedDay.appendChild( 
			document.createTextNode(daynameproducer.toLocaleDateString("en-US", { weekday: "long"}))
		);
		daySpanElem.appendChild(namedDay);
		daynameproducer.setDate(daynameproducer.getDate() + 1);
		const textboxForHours = document.createElement("input");
		daySpanElem.appendChild(textboxForHours);
		textboxForHours.className = "textboxForHours";
		weekdaysLabelElem.appendChild(daySpanElem);
		textboxForHours.addEventListener("change", (evt: Event) => {
			checkTimePeriods(evt.currentTarget as HTMLInputElement);
		});
		if (Math.floor(2*Math.random()) == 1)  // get two times, not just one
			if (Math.floor(2*Math.random()) == 0)  // get 12 hr
				textboxForHours.placeholder = 
					TIME_RANGES_EXAMPLE_PLACEHOLDER[0]["12h"] + ", " + 
					TIME_RANGES_EXAMPLE_PLACEHOLDER[1]["12h"];
			else 
				textboxForHours.placeholder = 
					TIME_RANGES_EXAMPLE_PLACEHOLDER[0]["24h"] + ", " + 
					TIME_RANGES_EXAMPLE_PLACEHOLDER[1]["24h"];
		else // get just one time period
			if (Math.floor(2*Math.random()) == 0)  // get 12 hr
				textboxForHours.placeholder = 
					TIME_RANGES_EXAMPLE_PLACEHOLDER[0]["12h"];
			else 
				textboxForHours.placeholder = 
					TIME_RANGES_EXAMPLE_PLACEHOLDER[0]["24h"];
	}
	const timePeriodsDivElem = document.createElement("div");
	timeControlDiv.appendChild(timePeriodsDivElem);
	timePeriodsDivElem.appendChild(document.createTextNode(
		"Set one or more time periods or ranges within the attendance days in which code submissions " +
		"will not be flagged. Codes sumbitted outside the time period(s) will be flagged " +
		"for notice."
	));
	timePeriodsDivElem.appendChild(document.createElement("br"));
	timePeriodsDivElem.appendChild(document.createTextNode(
		"Text entry formats for the time ranges must be in the format " + 
		"'HH:MM[am|pm]-HH:MM[am|pm]' indicating start and stop times for the " + 
		"range. Multiple ranges are permitted separated by a comma. " +
		"Entries will be validated"
	));
	
   const processButton: HTMLButtonElement = document.getElementById("submit-button")! as HTMLButtonElement;
	processButton.addEventListener("click", async () => {
//		if (!rosterContent && attendanceCsvFiles)
//			return Error("Nothing to process: Either the roster data or attendance data or both are missing");
//		const trimmedList = attendanceCsvFiles.filter(item => {
//			return item.name.search(/Attendance\d{8}\.csv/i) >= 0 ? item : undefined;
//		});
//		const attendanceFilesContents = await getContentsFromFiles(trimmedList);
//		const {sessionsData, rosterRecords } = coreProcessing(appInfo, rosterContent, attendanceFilesContents);
//		prepareCSVFiles(sessionsData, downloadFilesButtonsDiv);
//		reportToHTMLPage(sessionsData, rosterRecords );
	});
	rollTableDiv = document.getElementById("onpage-roll") as HTMLDivElement;
	downloadFilesButtonsDiv = document.getElementById("download-files-buttons") as HTMLDivElement;
	//processButton.click();
});

const dropZoneStaticInfo: {
	screeningREs: {re: string; flag: string}[];
	filesFolderInputId: string;
	handler: (e: DragEvent) => void;
}[] = [];
function droppedFilesProcessingInitialization(
	dropzoneHTMLid: string,
	screeningREs: {re: string; flag: string}[],
	filesFolderInputId: string
) {
	const filesDropZone = document.getElementById(dropzoneHTMLid) as HTMLInputElement;
	filesDropZone.className = "dropzone";
	filesDropZone.addEventListener('dragover', e => { 
		e.preventDefault(); // allow drop
	});
	const listener = (e: DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) {
			const items = e.dataTransfer.items;
			for (let i = 0; i < items.length; i++) {
				const entry = items[i].webkitGetAsEntry();
				if (entry && entry.isDirectory) {
					//(entry as FileSystemDirectoryEntry)
					(entry as FileSystemDirectoryEntry).createReader().readEntries(entries => {
						const dirEntriesRequest: Promise<File>[] = [];
						for (const entry of entries)
							dirEntriesRequest.push(new Promise((resolve, reject) => {
								if (entry.isFile) {
									const fileEntry = entry as FileSystemFileEntry;
									fileEntry.file(
										(theFile: File) => {
											resolve(theFile);
										}, 
										(err) => {
											// error callback
											reject(Warning(`${entry.name} folder fetch had following issue: ${err}`));
										}
									);
								}
							}));
						Promise.all(dirEntriesRequest).then((theFiles: File[]) => {
							limitFileTypes(theFiles, screeningREs);
							document.getElementById("attendance-files-folder-input")!.style.display = "none";
						}).catch(err => {
							Warning(`${entry.name} folder fetch had following issue: ${err}`);	
						});
					}, 
					(err) => {
						// error callback
						Warning(`${entry.name} folder fetch had following issue: ${err}`);
					});
				}
			}
		}
	};
	filesDropZone.addEventListener('drop', listener);
	dropZoneStaticInfo.push({
		screeningREs: screeningREs,
		filesFolderInputId: filesFolderInputId,
		handler: listener
	});
}

function checkTimePeriods(timePeriods: HTMLInputElement): void {
	
}

function limitFileTypes(
	fileList: File[],
	screeningRE: {re: string; flag: string;}[]
): File[] {
	const trimList: File[] = [];
	for (const file of fileList)
		//if (file.name.search(screeningRE) >= 0)
			{
			trimList.push(file);
			SelectList.appendChild(document.createTextNode(file.name));
			SelectList.appendChild(document.createElement("br"));
		}
	return trimList;
}

function getEmail(studentId: string, rosterRecords: RosterRecord[]): string | undefined {
	return rosterRecords.find(rec => rec.StudentId == studentId)?.Email;
}

/**
 * @function getContentsFromFiles
 * @param inputFiles
 * @returns 
 */
function getContentsFromFiles(inputFiles: File[]): Promise<string[]> {
	return new Promise<string[]>((resolve, reject) => {
		const fileRequests: Promise<string>[] = [];
		for (const inputFile of inputFiles)
			fileRequests.push(new Promise<string>((resolve, reject) => {
				try {
					const reader = new FileReader();
					reader.onload = (uploadEvent) => {
						resolve(uploadEvent.target!.result as string);
					};
					reader.readAsText(inputFile);
				} catch (e) {
					reject(e);
				}
			}));
		Promise.all(fileRequests).then((inputFilesContents: string[]) => {
			resolve(inputFilesContents);
		}).catch(err => {
			reject(err);
		});
	});
}

/**
 * @function reportToHTMLPage
 * @param sessionsData 
 * @param rosterRecords 
 */
function reportToHTMLPage(sessionsData: SessionData[], rosterRecords: RosterRecord[]): void {
	let params: TMakeTableParams;

	while (rollTableDiv.firstChild)
		rollTableDiv.removeChild(rollTableDiv.firstChild);
	// generation of tables on page
	for (const sessionData of sessionsData) {
		const sessionTableDiv = document.createElement("div");
		sessionTableDiv.className = "session-table";
		rollTableDiv.appendChild(sessionTableDiv);
		if (sessionData.Absent.length > 0) {
			const absentTableDiv = document.createElement("div");
			absentTableDiv.className = "absent-table";
			sessionTableDiv.appendChild(absentTableDiv);
			params = {
				title: {
					text: `${sessionData.SessionType} of ${sessionData.SessionDate} ` + 
						`(Code: ${sessionData.SessionCode})`,
					attribs: titleCaptionAttribs
				},
				subtitle: {
					text: "Absent",
					attribs: subtitleCaptionAttribs
				},
				headers: [ "Student ID", "Name", "Section", "Status", "Email"  ],
				data: sessionData.Absent,
				attach: rollTableDiv,
				display: [
					(item: AbsenceInfo ) => {return item.StudentID},
					(item: AbsenceInfo ) => {return item.Name},
	//				(item: AbsenceInfo ) => {return item.Section},
					(item: AbsenceInfo ) => {return item.Status},
					(item: AbsenceInfo ) => {return {
							attrib: "text-align:center;font:normal 10pt 'Courier New',Courier,monotype;",
							iValue: item.Email,
							wrapLink: `mailto:${item.Email}`
						}},
				//	(item: AbsenceInfo ) => {return item.SessionType},
				//	(item: AbsenceInfo ) => {return item.SessionDate}
				],
				options: {
					
				} as TMakeTableOptions
			};
			makeTable(params); // absent table
		}
		if (sessionData.Unmatched.length > 0) {
			const unmatchedTableDiv = document.createElement("div");
			unmatchedTableDiv.className = "absent-table";
			sessionTableDiv.appendChild(unmatchedTableDiv);
			params = {
				title: {
					text: `${sessionData.SessionType} of ${sessionData.SessionDate} ` + 
						`(Code: ${sessionData.SessionCode})`,
					attribs: titleCaptionAttribs // check with default styling
				},
				subtitle: {
					text: "Unmatched Records",
					attribs: subtitleCaptionAttribs
				},
				headers: [ "Student ID", "Session Type", "Timestamp"  ],
				data: sessionData.Unmatched,
				attach: rollTableDiv,
				display: [
					(item: UnmatchedRecord ) => {return item.StudentID},
					(item: UnmatchedRecord ) => {return item.SessionType},
					(item: UnmatchedRecord ) => {return setPacificTime(item.Timestamp)}
				],
				options: {
					
				} as TMakeTableOptions
			};
			makeTable(params); // absent table
		}
		const presentTableDiv = document.createElement("div");
			presentTableDiv.className = "present-table";
			sessionTableDiv.appendChild(presentTableDiv);

		params = {
			title: {
				text: `${sessionData.SessionType} of ${sessionData.SessionDate} ` + 
					`(Code: ${sessionData.SessionCode})`,
				attribs: titleCaptionAttribs // check with default styling
			},
			subtitle: {
				text: "Present",
				attribs: subtitleCaptionAttribs
			},
			headers: ["Student ID", "Name", "Section", "Timestamp", "Waitlist Position"],
			data: sessionData.Present,
			attach: rollTableDiv,
			display: [
				(item: AttendanceRecord) => { return item.StudentID },
				(item: AttendanceRecord) => { return item.Name },
//				(item: AttendanceRecord) => { return item.Section },
//				(item: AttendanceRecord) => { return item.SessionType },
				(item: AttendanceRecord) => { return setPacificTime(item.Timestamp) },
				(item: AttendanceRecord) => { return item.WaitlistPosition ? item.WaitlistPosition.toString() : "" },
			],
			options: {
			
			} as TMakeTableOptions
		}
		makeTable(params); // present table

		const combinedData: {
			StudentID: string;
			Name: string;
			Email: string;
//			Section: Section;
			SessionDate: string;
//			SessionType: SessionType;
			"Was Absent": "yes" | "no";
		}[] = [];
		for (const absent of sessionData.Absent) 
			combinedData.push({
				StudentID: absent.StudentID,
				Name: absent.Name,
				Email: absent.Email,
//				Section: absent.Section,
				SessionDate: absent.SessionDate,
//				SessionType: absent.SessionType,
				"Was Absent": "yes"
			});
		for (const present of sessionData.Present) 
			combinedData.push({
				StudentID: present.StudentID,
				Name: present.Name,
				Email: getEmail(present.StudentID, rosterRecords) || "not found",
//				Section: present.Section,
				SessionDate: sessionData.SessionDate,
//				SessionType: present.SessionType,
				"Was Absent": "no"
			});
		params = {
			title: {
				text: `${sessionData.SessionType} of ${sessionData.SessionDate} ` + 
					`(Code: ${sessionData.SessionCode})`,
				attribs: titleCaptionAttribs // check with default styling
			},
			subtitle: {
				text: `Combined List of Present and Absent`,
				attribs: subtitleCaptionAttribs // check with default styling
			},
			headers: ["Student ID", "Name", "Section", "Email", "Was Absent"	],
			data: combinedData,
			attach: rollTableDiv,
			display: [
				(item: AttendanceRecord) => { return item.StudentID },
				(item: AttendanceRecord) => { return item.Name },
//				(item: AttendanceRecord) => { return item.Section },
				(item) => { return item.Email },
				(item) => { return item["Was Absent"] },
			],
			options: {
			
			} as TMakeTableOptions
		}
		makeTable(params);
	}
}

/**
 * @function prepareCSVFiles
 * @param sessionsData 
 * @param containerElement 
 * @returns 
 */
function prepareCSVFiles(
	sessionsData: SessionData[], 
	containerElement: HTMLElement
): {absent: string; present: string; combined: string} {
	for (const session of sessionsData) {
	// generate the CSV records
		let fileRecords: string[][] = [];
			fileRecords.push(Object.keys(session.Absent));
			session.Absent.forEach(rec => Object.values(rec));
			fileRecords.push();
	// Prepare the download buttons
		const absentDownloadButton = document.createElement("button"),
				presentDownloadButton = document.createElement("button"),
				combinedDownloadButton = document.createElement("button");
		absentDownloadButton.appendChild(document.createTextNode("Download \"Absent Students\" CSV"));
		presentDownloadButton.appendChild(document.createTextNode("Download \"Present Students\" CSV"));
		combinedDownloadButton.appendChild(document.createTextNode("Download Combined Records CSV"));
		absentDownloadButton.addEventListener("click", () => {
			createFileDownload(containerElement, "#", "AbsentStudents.csv", true);
		});
		presentDownloadButton.addEventListener("click", () => {
			createFileDownload(containerElement, "#", "PresentStudents.csv", true);
		});
		combinedDownloadButton.addEventListener("click", () => {
			createFileDownload(containerElement, "#", "AllStudents.csv", true);
		});
	}
	return {} as {absent: string; present: string; combined: string};
}

/**
 * @function createFileDownload
 * @param containerNode 
 * @param href 
 * @param downloadFileName 
 * @param newTab
 */
function createFileDownload(
	containerNode: HTMLElement,
	href: string,
	downloadFileName: string,
	newTab?: boolean
): void {
	const aNode = document.createElement("a");

	aNode.setAttribute("href", href);
	aNode.setAttribute("download", downloadFileName);
	aNode.style.display = "none";
	if (newTab == true)
		aNode.target = "_blank";
	containerNode.appendChild(aNode);
	aNode.click();
	containerNode.removeChild(aNode);
}

/*
function setupMockFiles(files: string[]) {
	// Create a mock File object
	for (const file of files) {
		const mockFile = new File(
			["file content"], 
			file, 
			{ type: "text/csv" }
		);

		// Create an input element
		const input = document.createElement("input");
		input.type = "file";

		// Assign the mock file to the input's files property
		Object.defineProperty(input, "files", {
			value: [mockFile],
			writable: false,
		});

		// Dispatch the change event
		const event = new Event("change", { bubbles: true });
		input.dispatchEvent(event);
	}
}

setupMockFiles([
	"",
	"14 Aug Attendance.csv"
]);*/