export { SessionAnalysis, RosterRecord, SectionRoster, SessionRecord, 
   AttendanceRecord, AbsenceInfo, UnmatchedRecord, CsvRecord, TermData,
	Status, AppInfo, PRNRosterRecord, PRNFileInfo, RosterStatus, AttendanceCSVRaw,
	SelfServiceCsvExport, RosterCabinet, AttendanceCabinet, SessionReport, YamlCode
	// Section  SessionType
};

/*declare module "csv-parse/browser/esm/sync" {
  import { Parser } from "csv-parse";
  export function parse(input: string): any[];
} */

//declare module "node-file-dialog";

type TermData = {
	term: string;
	sections: {
		day: string; // Mon, Tue, ect
		number: number;  // section number
	}[];
	daySwap: number[];
	path: string;			
};

type AppInfo = { // read in from SimpleAttendance.yaml
	courseName: string;
	activeTerm: string; // example 'Spring26'
	termsFolderPaths: {
		downloadsFolder: string;
		terms: TermData[];
	};
	rosters: {
		recordsHeaders: string[];
		fileNamePrompt: string;  // "Chem3A-<5-digitSec#> roster YYYYMMDD.prn"
		fileNamesRE: string;  // "Chem3[Aa]-?\\d{5}\\s+roster \\d{8}\\.prn"
		filesRelpath: string;  //  Attendance/Roster Records
	};
	attendance: {
		recordsHeaders: string[];
		fileNamePrompt: string[] // ["AttendanceYYYYMMDD.csv", "AttendanceYYYYMMDD.csv.zip"]
  		fileNamesRE: string;  //- "Chem 3A Course Attendance\\d{8}\\.csv(\\.zip)?"
		filesRelpath: string; // Attendance/Attendance Records
	};
	reports: {
		relpath: string; // "Attendance/Attendance Reports"
		fileNameFormat: string; // "Attendance Report-YYYYMMDD #NN.txt"
	}
	debug: {
		rosters: string[];
		attendance: string[];
	}
	codesUsed: {
		date: string;
		lecture: string;
		lab: string;
	}[];
};

type SessionType = string;
// type SessionType = "Lecture" | "Tuesday Lab" | "Thursday Lab";

type Status = "Enrolled" | "Waitlisted" | "Dropped";

//type Section = string; //= "43957" | "43958";

type SessionRecord = {
	Timestamp: Date;
	"Student ID": string;
	"Attendance Code": string;
	Name: string;
};

type RosterRecord = {
	Section: number;
	Name: string;
	StudentId: string;
	Email: string;
	Status: Status;
	"Wait Position": number;
};

type SectionRoster = {
	Section: number;
	Roster: RosterRecord[];
};

type AttendanceCSVRaw = {
	Timestamp: string;
	"Student ID": string;
	"Attendance Code": string;
	Name: string;
};

type AttendanceRecord = {
	Name: string;
	StudentID: string;
	RecordedName: string;
	Timestamp: Date;
	Section: number;
	SessionType: SessionType;
	WaitlistPosition: number | undefined;
};

type RosterCabinet = {
	fileNames: string[];
	records: RosterRecord[];  // row as string which are recoreds
};

type AttendanceCabinet = {
	drawers: {
		fileName: string;
		records: string[];  // row as string which are recoreds
	}[];
};


type AbsenceInfo = {
	Name: string;
	StudentID: string;
	Email: string;
	Section: number;
	Status: Status
	SessionType: SessionType;
	SessionDate: string;   // datetime as string
};

type UnmatchedRecord = {
	StudentID: string;
	RecordedName: string;
	SessionType: SessionType;
	Timestamp: Date;
};

type SessionAnalysis = {
	SessionCode: string;
	SessionType: string;
	SessionDate: string;
	Headers: {
		present: string[];
		absent: string[];
//		unmatched: string[];
	};
	Present: AttendanceRecord[];
	Absent: AbsenceInfo[];
	Unmatched: UnmatchedRecord[];
};

type SessionReport = {
	fileNames: {
		rosters: string[];
		attendance: string[];
	};
	sessions: SessionAnalysis[];
};

type CsvRecord = {
	StudentID: string;
	Name: string;
	RecordedName?: string;
	Email: string;
	Section: number;
	Status: Status;
	SessionDate: string; // date as string
	SessionType: SessionType;
	Absent: "yes" | "no";
	Timestamp: Date | null;
	WaitlistPosition: number | null;
};

type RosterStatus = "Enrolled" | "Waitlisted" | "Dropped";

type SelfServiceCsvExport = {
	"Student Name": string;
	"Student ID": string
	"Preferred Email": string;
}

type PRNRosterRecord = {
	position: number;
	name: string;
	studentId: string;
	email: string;
	status: RosterStatus;
}	

type PRNFileInfo = {
	fileNameFullPath: string;
	datetime: Date;
	section: number;
	term: string;
	size: { capacity: number; enrolled: number; waitlisted: number;};
	students: {
		enrolled: PRNRosterRecord[];
		waitlisted: PRNRosterRecord[];
		dropped: PRNRosterRecord[];
	}
}

type YamlCode = {
	date: string;
	lecture: string;
	lab: string;
};