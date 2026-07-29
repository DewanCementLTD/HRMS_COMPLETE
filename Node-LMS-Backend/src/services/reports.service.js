/**
 * HR Reports Service — Provides data for Payroll & General HR Reports.
 *
 * NOTE: Returns structured JSON array responses matching production table schemas.
 * Replace mock return values with live Oracle SQL queries when ready.
 */

export const getAbsentSuppReport = async (filters = {}) => {
  return [
    { sr_no: 1, code: "A-439", employee_name: "ATTA UR REHMAN", designation: "INSTRUMENT", department: "Karachi Factory", absent: 3.0, s_days: 0.0 },
    { sr_no: 2, code: "A-479", employee_name: "ABDUL HAKEEM", designation: "MECHANICAL", department: "Karachi Factory", absent: 1.5, s_days: 0.0 },
    { sr_no: 3, code: "A-480", employee_name: "AYAZ ALI JOKHIO", designation: "ADMIN", department: "Karachi Factory", absent: 9.5, s_days: 0.0 },
    { sr_no: 4, code: "B-41", employee_name: "BILAWAL SHAIKH", designation: "MECHANICAL", department: "Karachi Factory", absent: 1.5, s_days: 0.0 },
    { sr_no: 5, code: "G-64", employee_name: "GHULAM MURTAZA", designation: "ELECTRICAL", department: "Karachi Factory", absent: 0.0, s_days: 4.5 },
    { sr_no: 6, code: "I-89", employee_name: "IMRAN ALI", designation: "QUARRY", department: "Karachi Factory", absent: 13.0, s_days: 0.0 },
    { sr_no: 7, code: "I-92", employee_name: "IBRAHEEM", designation: "MECHANICAL", department: "Karachi Factory", absent: 1.0, s_days: 0.0 },
    { sr_no: 8, code: "J-59", employee_name: "JAMEEL AHMED", designation: "W.H.R.S", department: "Karachi Factory", absent: 1.0, s_days: 0.0 },
    { sr_no: 9, code: "K-95", employee_name: "KARAM KHAN JOKHIO", designation: "STORE", department: "Karachi Factory", absent: 6.0, s_days: 0.0 },
    { sr_no: 10, code: "M-642", employee_name: "MUHAMMAD JUMMAN BALOCH", designation: "PROCESS", department: "Karachi Factory", absent: 3.0, s_days: 0.0 },
  ];
};

export const getAllowanceDetailReport = async (filters = {}) => {
  return [
    { code: "A-346", employee_name: "ABDUL RAHEEM", ot_hours: 8, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 2020, total: 2020 },
    { code: "A-451", employee_name: "ABID ALI", ot_hours: 0, expenses_reimburs: 0, lfa: 28702, medical: 0, over_time: 0, total: 28702 },
    { code: "A-472", employee_name: "ALI RAZA", ot_hours: 51, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 12656, total: 12656 },
    { code: "A-476", employee_name: "ABDUL AZIZ", ot_hours: 35, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 8218, total: 8218 },
    { code: "A-478", employee_name: "AHMED GADEHI", ot_hours: 12, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 3811, total: 3811 },
    { code: "A-481", employee_name: "ATIF ZAEEM QURESHI", ot_hours: 0, expenses_reimburs: 0, lfa: 0, medical: 29910, over_time: 0, total: 29910 },
    { code: "B-27", employee_name: "BAKHSHAL SOOMRO", ot_hours: 0, expenses_reimburs: 6000, lfa: 0, medical: 0, over_time: 0, total: 6000 },
    { code: "B-41", employee_name: "BILAWAL SHAIKH", ot_hours: 24, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 7557, total: 7557 },
    { code: "B-42", employee_name: "BASHIR MUHAMMAD", ot_hours: 12, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 3263, total: 3263 },
    { code: "E-3", employee_name: "EIDEN KHASKHELI", ot_hours: 52, expenses_reimburs: 0, lfa: 0, medical: 0, over_time: 18125, total: 18125 },
  ];
};

export const getAllowanceReconReport = async (filters = {}) => {
  return [
    { code: "A-451", employee_name: "ABID ALI", month1_amount: 28702, month2_amount: 0, variance: 28702 },
    { code: "B-39", employee_name: "BUSHRA SHABBIR", month1_amount: 13489, month2_amount: 0, variance: 13489 },
    { code: "E-2", employee_name: "EBAD ULLAH KHAN", month1_amount: 14715, month2_amount: 0, variance: 14715 },
    { code: "F-94", employee_name: "FAYAZ ALI", month1_amount: 14315, month2_amount: 0, variance: 14315 },
    { code: "I-61", employee_name: "IRFAN AHMED ABRO", month1_amount: 50851, month2_amount: 0, variance: 50851 },
    { code: "K-92", employee_name: "KASHIF RASHEED", month1_amount: 10647, month2_amount: 0, variance: 10647 },
    { code: "M-471", employee_name: "MUBASHIR KHAN", month1_amount: 27403, month2_amount: 0, variance: 27403 },
    { code: "S-375", employee_name: "SYED FARHAN ASDAQUE", month1_amount: 0, month2_amount: 83774, variance: -83774 },
  ];
};

export const getDeductionDetailReport = async (filters = {}) => {
  return [
    { code: "A-409", employee_name: "ASIF SHAHZAD", advance_loan: 0, advance_salary: 0, cable_charges: 0, cell_phone: 0, electric_charges: 7648, total: 7648 },
    { code: "A-440", employee_name: "ABDUL AZEEM ZAHID", advance_loan: 0, advance_salary: 0, cable_charges: 250, cell_phone: 0, electric_charges: 8039, total: 8289 },
    { code: "A-447", employee_name: "ARSHAD MEHMOOD", advance_loan: 0, advance_salary: 0, cable_charges: 250, cell_phone: 0, electric_charges: 2365, total: 2615 },
    { code: "A-470", employee_name: "ALLAH RAKHA", advance_loan: 0, advance_salary: 0, cable_charges: 250, cell_phone: 0, electric_charges: 2843, total: 3093 },
    { code: "A-471", employee_name: "ASHIQ ALI", advance_loan: 0, advance_salary: 0, cable_charges: 0, cell_phone: 0, electric_charges: 1787, total: 1787 },
    { code: "A-475", employee_name: "AMIR SIMON", advance_loan: 0, advance_salary: 0, cable_charges: 0, cell_phone: 0, electric_charges: 865, total: 865 },
    { code: "A-477", employee_name: "ASHRAF UDDIN JOKHIO", advance_loan: 0, advance_salary: 0, cable_charges: 250, cell_phone: 0, electric_charges: 10397, total: 10647 },
    { code: "A-481", employee_name: "ATIF ZAEEM QURESHI", advance_loan: 0, advance_salary: 0, cable_charges: 0, cell_phone: 129, electric_charges: 0, total: 129 },
    { code: "B-27", employee_name: "BAKHSHAL SOOMRO", advance_loan: 5257, advance_salary: 0, cable_charges: 0, cell_phone: 0, electric_charges: 0, total: 5257 },
    { code: "G-64", employee_name: "GHULAM MURTAZA", advance_loan: 0, advance_salary: 9321, cable_charges: 0, cell_phone: 0, electric_charges: 0, total: 9321 },
  ];
};

export const getDeductionReconReport = async (filters = {}) => {
  return [
    { code: "A-199", employee_name: "ABDUL NAEEM ABBASI", month1_amount: 5948, month2_amount: 5948, variance: 0 },
    { code: "A-257", employee_name: "ADNAN", month1_amount: 5257, month2_amount: 5257, variance: 0 },
    { code: "B-27", employee_name: "BAKHSHAL SOOMRO", month1_amount: 5257, month2_amount: 5257, variance: 0 },
    { code: "F-53", employee_name: "FARHAN KHAN", month1_amount: 4627, month2_amount: 4627, variance: 0 },
    { code: "G-33", employee_name: "GHOUS BUX SHAR", month1_amount: 4940, month2_amount: 4940, variance: 0 },
    { code: "G-63", employee_name: "GHAZANFAR BABER SIDDIQI", month1_amount: 100000, month2_amount: 100000, variance: 0 },
    { code: "S-480", employee_name: "SOHAIL MUNAWAR", month1_amount: 4627, month2_amount: 4627, variance: 0 },
    { code: "S-522", employee_name: "SHEIKH HUMOOD UR REHMAN", month1_amount: 5257, month2_amount: 5257, variance: 0 },
  ];
};

export const getMonthWiseDeductionReport = async (filters = {}) => {
  return [
    { code: "A-264", employee_name: "ADIL IQBAL", month1_amount: 914, month2_amount: 914, month3_amount: 913, total: 2740 },
    { code: "A-299", employee_name: "ABDUL RAHEEM KHAN", month1_amount: 216, month2_amount: 216, month3_amount: 216, total: 648 },
    { code: "A-310", employee_name: "AIZA UDDIN", month1_amount: 113, month2_amount: 113, month3_amount: 113, total: 338 },
    { code: "A-322", employee_name: "AFTAB AHMED BAQAI", month1_amount: 472, month2_amount: 472, month3_amount: 472, total: 1415 },
    { code: "A-333", employee_name: "ABDUL RASHEED", month1_amount: 177, month2_amount: 177, month3_amount: 177, total: 531 },
    { code: "A-346", employee_name: "ABDUL RAHEEM", month1_amount: 100, month2_amount: 130, month3_amount: 150, total: 380 },
    { code: "A-409", employee_name: "ASIF SHAHZAD", month1_amount: 4433, month2_amount: 4433, month3_amount: 4433, total: 13299 },
    { code: "A-440", employee_name: "ABDUL AZEEM ZAHID", month1_amount: 14105, month2_amount: 14105, month3_amount: 14105, total: 42315 },
  ];
};

export const getBankAdviceReport = async (filters = {}) => {
  return [
    { sr_no: 1, code: "B-39", employee_name: "BUSHRA SHABBIR", account_number: "01891008165038", salary_payable: 65672, bank_name: "BANK ALFALAH", branch_code: "BAF_SHF" },
  ];
};

export const getActiveEmployeesReport = async (filters = {}) => {
  return [
    { sr_no: 1, unit: "KARACHI", location: "Karachi Factory", code: "M-803", employee_name: "MOHAMMAD UMAR", grade: "JM-1", designation: "ASSOCIATE ENG-I", department: "H. O. U. CELL", section: "ARCHIVE", qualification: "DIPLOMA", type: "Permanent", date_of_birth: "24-Oct-1978", date_of_joining: "05-Nov-2022", date_of_confirm: "05-Jul-2023", gross: 77280 },
    { sr_no: 2, unit: "KARACHI", location: "Karachi Factory", code: "Q-28", employee_name: "QADIR BUX", grade: "JM-1", designation: "ASSOCIATE ENG-I", department: "W.H.R.S", section: "", qualification: "PRIMARY", type: "Permanent", date_of_birth: "02-Oct-1970", date_of_joining: "01-Apr-2025", date_of_confirm: "01-May-2025", gross: 50000 },
    { sr_no: 3, unit: "KARACHI", location: "Karachi Factory", code: "R-58", employee_name: "RAO NASIR KHALIQ", grade: "JM-1", designation: "ASSOCIATE ENG-I", department: "ELECTRICAL", section: "", qualification: "CERTIFICATION", type: "Permanent", date_of_birth: "26-Sep-1980", date_of_joining: "07-Feb-2008", date_of_confirm: "07-Aug-2008", gross: 117816 },
    { sr_no: 4, unit: "KARACHI", location: "Karachi Factory", code: "Z-54", employee_name: "ZAREEN AKHTAR", grade: "JM-1", designation: "ASSOCIATE ENG-I", department: "MECHANICAL", section: "", qualification: "MIDDLE", type: "Permanent", date_of_birth: "07-Sep-1971", date_of_joining: "16-Nov-2006", date_of_confirm: "16-May-2007", gross: 129594 },
    { sr_no: 5, unit: "KARACHI", location: "Karachi Factory", code: "S-656", employee_name: "SADDAM HUSSAIN", grade: "JM-1", designation: "ASSOCIATE ENGINEER", department: "PROCESS", section: "", qualification: "BACHELOR OF SCIEN", type: "Permanent", date_of_birth: "10-Aug-1993", date_of_joining: "01-Apr-2026", date_of_confirm: "01-Oct-2026", gross: 100000 },
  ];
};

export const getPfDetailReport = async (filters = {}) => {
  return {
    employee_header: {
      code: "M-866",
      name: "MUHAMMAD ZOHAIB FAROOQUI",
      unit: "KARACHI",
      department: "INFORMATION TECHNOLOGY",
      designation: "SOFTWARE ENGINEER"
    },
    ledger: [
      { sr_no: 1, month_year: "Nov-2025", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 157914, pf_contribution: 0, balance: 0 },
      { sr_no: 2, month_year: "Dec-2025", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 140000, pf_contribution: 0, balance: 0 },
      { sr_no: 3, month_year: "Jan-2026", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 135484, pf_contribution: 0, balance: 0 },
      { sr_no: 4, month_year: "Feb-2026", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 140000, pf_contribution: 0, balance: 0 },
      { sr_no: 5, month_year: "Mar-2026", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 135484, pf_contribution: 0, balance: 0 },
      { sr_no: 6, month_year: "Apr-2026", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 139849, pf_contribution: 0, balance: 0 },
      { sr_no: 7, month_year: "May-2026", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 140000, pf_contribution: 7490, balance: 7490 },
      { sr_no: 8, month_year: "Jun-2026", actual_basic: 89919, earned_basic: 89919, actual_gross: 140000, earned_gross: 140000, pf_contribution: 7490, balance: 14981 },
    ],
    account_summary: {
      employee_contribution: 14981,
      employer_contribution: 14981,
      loan_against_pf: 0,
      permanent_withdrawal_pf: 0,
      total_pf: 29961
    },
    pw_withdrawals: []
  };
};
