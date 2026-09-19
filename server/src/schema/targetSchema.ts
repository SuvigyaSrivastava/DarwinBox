// The target platform's employee schema. This is the "given" spec the agent
// maps every source file into. Field `aliases` are common synonyms the
// mapping engine uses as fast-path hints before falling back to the LLM.

export type FieldType = "string" | "email" | "phone" | "date" | "enum" | "number";

export interface TargetField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  enumValues?: string[];
  aliases: string[];
  description: string;
}

export const TARGET_SCHEMA: TargetField[] = [
  {
    key: "employee_id",
    label: "Employee ID",
    type: "string",
    required: true,
    aliases: ["emp id", "employee id", "id", "empid", "staff id", "personnel number"],
    description: "Unique identifier for the employee in the source system.",
  },
  {
    key: "first_name",
    label: "First Name",
    type: "string",
    required: true,
    aliases: ["first name", "firstname", "given name", "fname"],
    description: "Employee's given/first name.",
  },
  {
    key: "last_name",
    label: "Last Name",
    type: "string",
    required: true,
    aliases: ["last name", "lastname", "surname", "family name", "lname"],
    description: "Employee's family/last name.",
  },
  {
    key: "email",
    label: "Email",
    type: "email",
    required: true,
    aliases: ["email", "email address", "work email", "e-mail"],
    description: "Primary work email address.",
  },
  {
    key: "phone",
    label: "Phone",
    type: "phone",
    required: false,
    aliases: ["phone", "phone number", "mobile", "cell", "contact number", "cell phone"],
    description: "Primary contact phone number.",
  },
  {
    key: "department",
    label: "Department",
    type: "string",
    required: true,
    aliases: ["department", "dept", "division", "business unit", "dept code", "department code", "team"],
    description: "The organizational department/business unit the employee belongs to.",
  },
  {
    key: "job_title",
    label: "Job Title",
    type: "string",
    required: true,
    aliases: ["job title", "title", "position", "role", "designation"],
    description: "The employee's job title or role name.",
  },
  {
    key: "employment_status",
    label: "Employment Status",
    type: "enum",
    required: true,
    enumValues: ["active", "terminated", "on_leave"],
    aliases: ["status", "employment status", "employee status"],
    description: "Current employment status.",
  },
  {
    key: "employee_type",
    label: "Employee Type",
    type: "enum",
    required: false,
    enumValues: ["full_time", "part_time", "contractor", "intern"],
    aliases: ["employee type", "worker type", "employment type"],
    description: "Employment classification.",
  },
  {
    key: "start_date",
    label: "Start Date",
    type: "date",
    required: true,
    aliases: ["start date", "hire date", "date of joining", "doj", "joining date", "hire dt", "contract start"],
    description: "Date the employee started.",
  },
  {
    key: "end_date",
    label: "End Date",
    type: "date",
    required: false,
    aliases: ["end date", "termination date", "last working day", "separation date", "term dt", "contract end"],
    description: "Date the employee's employment ended, if applicable.",
  },
  {
    key: "manager_email",
    label: "Manager Email",
    type: "email",
    required: false,
    aliases: ["manager email", "reports to", "supervisor email", "supervisor", "manager"],
    description: "Email of the employee's direct manager.",
  },
  {
    key: "location",
    label: "Location",
    type: "string",
    required: false,
    aliases: ["location", "office", "site", "work location", "city"],
    description: "Office or work location.",
  },
  {
    key: "salary_band",
    label: "Salary Band",
    type: "string",
    required: false,
    aliases: ["salary band", "pay grade", "band", "level", "grade"],
    description: "Compensation band/grade classification (not raw salary).",
  },
];

export const TARGET_SCHEMA_BY_KEY: Record<string, TargetField> = Object.fromEntries(
  TARGET_SCHEMA.map((f) => [f.key, f]),
);
