import type {
   RosterRecord, SessionRecord, SessionAnalysis, SectionRoster, AttendanceRecord,
   UnmatchedRecord, AbsenceInfo, CsvRecord, Status, AppInfo, RosterCabinet, AttendanceCabinet
} from "./types/simpleattendanceTypes.d.ts";


export { coreProcessing, setPacificTime };

import { multiSort, sortByKey } from "./GenLib/arraysExtended.js";
import { parse } from "../node_modules/csv-parse/dist/esm/sync.js";
import { stringify } from "../node_modules/csv-stringify/dist/esm/sync.js";
//import { profile } from "node:console";


const daysMatch = [
   { short: "MON", long: "Monday" },
   { short: "TUE", long: "Tuesday" },
   { short: "WED", long: "Wednesday" },
   { short: "THU", long: "Thursday" },
   { short: "FRI", long: "Friday" },
   { short: "SAT", long: "Saturday" },
]

function coreProcessing(
   appInfo: AppInfo,
   rosterCabinet: RosterCabinet,
   attendanceCabinet: AttendanceCabinet // keep the contents of all files separate as strings
): {sessionAnalysis: SessionAnalysis[]; rosterRecords: RosterRecord[]; csvData: string;} {
   // clean up the attendance records content
   let rawSessionRecords: SessionRecord[] = [];
   const termData = appInfo.termsFolderPaths.terms.find(elem => elem.term == appInfo.activeTerm);
   const labSwitchers: { id: number; day: string; }[] = [];
   if (termData)
      for (const id of termData.daySwap)
         if (rosterCabinet.records.find(elem => {
            if (parseInt(elem.StudentId) == id)
               labSwitchers.push({
                  id: id,
                  day: termData.sections.find(elem2 => elem2.number == elem.Section)!.day
               });
            })
         ) {}  // empty if statement body
   // attendance files as string ==> records as arrays
   for (const drawer of attendanceCabinet.drawers)
      // Timestamp, Student ID, Attendance Code, optional Name
      rawSessionRecords = rawSessionRecords.concat(parse(drawer.records.join("\n"), {
         columns: true,
         relaxQuotes: true,
         relax_column_count: true,
         skip_empty_lines: true
      }));

/* - rawSessionRecords[] contains every entry of student recording attendance with a timestamp
      it will be sorted by attendance code
   - rosterRecords[] contains the roster that session records will be compared to
      It will be sorted by section
*/
   const rawSectionRosters: SectionRoster[] = [];
   let prevRecord: number = -1;

   // Section, Name, StudentId, Email, Status
   //  Status: "Enrolled" | "Waitlisted" | "Dropped"

   let list: RosterRecord[] = [];
   const identifiedSections: number[] = [],
      addMissingElement = <T>(array: T[], element: T): void => {
         if (!array.includes(element)) { array.push(element)};
      };
   for (const rosRec of rosterCabinet.records) {
      if (prevRecord != rosRec.Section) {
         list = [];
         rawSectionRosters.push({
            Section: rosRec.Section,
            Roster: list
         });
         prevRecord = rosRec.Section;
      }
      addMissingElement(identifiedSections, rosRec.Section);
      list.push(rosRec);
   }
   const sectionRosters: { section: number; records: RosterRecord[] }[] = 
      Object.entries(Object.groupBy(multiSort(
            rosterCabinet.records, 
               [
                  { key: "Section"},
                  { key: "Name" }      
               ]
            ), (rec) => rec.Section )).map(
            ([section, records]) => ({
               section: Number(section),
               records: records ?? []
            })
      );
       
   /*
      - Define const 'Present', 'Absent' to be array of object of this type
            Student ID, Name, Section, Class, Date, Waitlisted?
            Class: lecture, Tuesday lab, Thurs lab
      - sort attendance records into Sessions Blocks using Attendance Code
         get the date of Session Block
      - for each Session Block
         initialize a SessionAnalysis object
         for each student in the roster
            if an enrolled student is not found, place that student in "Absent"
            if enrolled, waitlisted, and dropped is found, add to "Present"
   */
   const sessionAnalysis: SessionAnalysis[] = [];
   let sessionCode: string = "",
      sessionLabSection: number | undefined,
      sessionRecord: SessionRecord | undefined,
      sessionRecords: SessionRecord[] = [],
      present: AttendanceRecord[] = [], 
      absent: AbsenceInfo[] = [],
      unmatched: UnmatchedRecord[] = [],
      sessionType: string,
      sessionDate: string,
      csvRecords: CsvRecord[] = [],
      sessionSRecords: SessionRecord[][] = [];

   rawSessionRecords = sortByKey(rawSessionRecords, "Attendance Code");
   const foundSessionCodes: {code:string;count:number}[] = [];
   let index: number = -1;
   for (const sessionRecord of rawSessionRecords) {
      const recordedCode = sessionRecord["Attendance Code"].trim().toUpperCase();
      if (sessionCode != recordedCode) {
         index = foundSessionCodes.push({
            code: recordedCode,
            count: 1
         }) - 1;
         sessionRecords = [];
         sessionSRecords.push(sessionRecords);
         sessionCode = recordedCode;
      } else 
         foundSessionCodes[index].count++;
      sessionRecords.push(sessionRecord);
   }
   sessionSRecords.sort((a: SessionRecord[], b: SessionRecord[]) => {
      return a[0].Timestamp > b[0].Timestamp ? 1 : a[0].Timestamp < b[0].Timestamp ? -1 : 0;
   });
   // constructing a Session Roster here from the Session Blocks
   const relevantSections = appInfo.termsFolderPaths.terms.find(elem => elem.term == appInfo.activeTerm)!.sections;
   for (let sessionRecords of sessionSRecords) {
      sessionRecords = sortByKey(sessionRecords, "Timestamp");
      let sessionRoster: RosterRecord[] = [];
      sessionCode = sessionRecords[0]["Attendance Code"];
      const sessionDay = daysMatch.find(elem => elem.short == sessionCode.slice(-3).toUpperCase());
      if (!sessionDay) { // has to be lecture
         sessionType = "Lecture";
         for (const rec of sectionRosters)
           sessionRoster = sessionRoster.concat(rec.records);
      } else { // has to be lab
         let foundSection; 
         if (!(foundSection = relevantSections.find(elem => elem.day.toUpperCase() == sessionDay.short)))
            throw Error(`Cannot find a lab day in session record that is defined as section in YAML config file`);
         sessionLabSection = foundSection.number;
         sessionType = `${sessionDay.long} Lab`;
         sessionRoster = sectionRosters.find(sec => sec.section == sessionLabSection)!.records;    
      }
      sessionDate = new Date(sessionRecords[0].Timestamp).toLocaleDateString();
      let found;
      for (const rosterRecord of sessionRoster)
// take one record in the roster
         if (sessionRecord = sessionRecords.find(blockRec => blockRec["Student ID"] == rosterRecord.StudentId)) {
            if (sessionDay && (found = labSwitchers.find(elem => elem.id == Number(rosterRecord.StudentId)) != undefined)) {
               if (sessionLabSection == rosterRecord.Section)
                  continue;
               else {
                  present.push({
                     Name: rosterRecord.Name,
                     StudentID: rosterRecord.StudentId.toString(),
                     RecordedName: sessionRecord.Name,
                     Section: rosterRecord.Section,
                     Timestamp: sessionRecord.Timestamp,
                     SessionType: sessionType,
                     WaitlistPosition: isNaN(rosterRecord["Wait Position"]) ? undefined : rosterRecord["Wait Position"]
                  });
                  csvRecords.push({
                     Name: rosterRecord.Name,
                     StudentID: rosterRecord.StudentId.toString(),
                     Email: rosterRecord.Email,
                     Section: rosterRecord.Section,
                     Status: rosterRecord.Status,
                     SessionDate: sessionDate,
                     SessionType: sessionType,
                     Absent: "no",
                     Timestamp: sessionRecord.Timestamp,
                     WaitlistPosition: null
                  });
               }
               // student ID in session matches student ID in roster
            } else if (rosterRecord.Status == "Enrolled" || rosterRecord.Status == "Waitlisted") {
   // the status is either enrolled or waitlists: add to Present records
               present.push({
                  Name: rosterRecord.Name,
                  StudentID: rosterRecord.StudentId.toString(),
                  RecordedName: sessionRecord.Name,
                  Section: rosterRecord.Section,
                  Timestamp: sessionRecord.Timestamp,
                  SessionType: sessionType,
                  WaitlistPosition: isNaN(rosterRecord["Wait Position"]) ? undefined : rosterRecord["Wait Position"]
               });
               csvRecords.push({
                  Name: rosterRecord.Name,
                  StudentID: rosterRecord.StudentId.toString(),
                  Email: rosterRecord.Email,
                  Section: rosterRecord.Section,
                  Status: rosterRecord.Status,
                  SessionDate: sessionDate,
                  SessionType: sessionType,
                  Absent: "no",
                  Timestamp: sessionRecord.Timestamp,
                  WaitlistPosition: null
               });
            }
         } else if (rosterRecord.Status == "Enrolled") {
// this is record in the roster, and the condition of being Present or Waitlisted was not met
            absent.push({
               Name: rosterRecord.Name,
               StudentID: rosterRecord.StudentId.toString(),
               Email: rosterRecord.Email,
               Section: rosterRecord.Section,
               Status: rosterRecord.Status,
               SessionType: sessionType,
               SessionDate: sessionDate
            });
            csvRecords.push({
            	Name: rosterRecord.Name,
            	StudentID: rosterRecord.StudentId.toString(),
            	Email: rosterRecord.Email,
               Section: rosterRecord.Section,
               Status: rosterRecord.Status,
               SessionDate: sessionDate,
               SessionType: sessionType,
               Absent: "yes",
               Timestamp: null,
               WaitlistPosition: null
            });
         }
// running through the roster once complete
// now to go through the records and find IDs not matched: students forgetting their IDs
      for (const sessionRecord of sessionRecords)
         if (rosterCabinet.records.find(rosRec =>
            rosRec.StudentId == sessionRecord["Student ID"] //&&
           // rosRec.Status == "Enrolled"
         )) // if ID was found in roster and in session record, skip this
            continue;
         else {  // get the iD and recorded name
            unmatched.push({
               StudentID: sessionRecord["Student ID"].toString(),
               RecordedName: sessionRecord.Name,
               SessionType: sessionType,
               Timestamp: sessionRecord.Timestamp
            });
				csvRecords.push({
            	StudentID: sessionRecord["Student ID"],
            	Name: "unknown",
               RecordedName: sessionRecord.Name,
               Absent: "no",
               Timestamp: sessionRecord.Timestamp,
            	Email: "",
               Section: -1,
               Status: "" as Status,
               SessionDate: sessionDate,
               SessionType: sessionType,
               WaitlistPosition: null
            });
			}
// collect all the information on the sesson and matched students
      sessionAnalysis.push({
         Headers: {
            present: present.length > 0 ? Object.keys(present[0]) : [""],
            absent: absent.length > 0 ? Object.keys(absent[0]) : [""],
//            unmatched: Object.keys(unmatched[0])
         },
         Present: present,
         Absent: absent,
         Unmatched: unmatched,
         SessionCode: sessionCode,
         SessionType: sessionType,
         SessionDate: sessionDate.toLocaleString(),
      });
      present = [];
      absent = [];
      unmatched = [];
   }
   const stringified = stringify(csvRecords, {
      header: true
   })
   return {sessionAnalysis: sessionAnalysis, rosterRecords: rosterCabinet.records, csvData: stringified};
}

function setPacificTime(timestamp: Date): string {
	return new Intl.DateTimeFormat("en-us", {
		timeZone: "America/Los_Angeles",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		timeZoneName: "short"
	}).format(new Date(timestamp));
}
