-- ============================================================================
-- DEWAN CEMENT LIMITED - HRMS & FULL ERP DATABASE REDESIGN FOR POSTGRESQL 17
-- ============================================================================
-- Complete Master DDL Script
-- Target Database: PostgreSQL 17+
-- Architecture: Multi-Schema, Fully Normalized (3NF), Audit-Enabled, RBAC Access
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMAS & EXTENSIONS CREATION
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS access_control;
CREATE SCHEMA IF NOT EXISTS geography;
CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS leave_mgmt;
CREATE SCHEMA IF NOT EXISTS payroll;
CREATE SCHEMA IF NOT EXISTS recruitment;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS benefits;
CREATE SCHEMA IF NOT EXISTS budget;
CREATE SCHEMA IF NOT EXISTS finance;

-- ----------------------------------------------------------------------------
-- 2. AUDIT TRIGGER FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit.set_updated_at() IS 'Trigger function to automatically update the updated_at timestamp column.';

-- ============================================================================
-- 3. GEOGRAPHY SCHEMA
-- ============================================================================
CREATE TABLE geography.country (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_country_code UNIQUE,
    name varchar(100) NOT NULL,
    iso_code_alpha2 varchar(2),
    iso_code_alpha3 varchar(3),
    phone_code varchar(10),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE TRIGGER trg_geography_country_updated_at BEFORE UPDATE ON geography.country FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE geography.state (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    country_id bigint NOT NULL CONSTRAINT fk_state_country REFERENCES geography.country(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_state_country_code UNIQUE (country_id, code)
);
CREATE INDEX idx_state_country ON geography.state(country_id);
CREATE TRIGGER trg_geography_state_updated_at BEFORE UPDATE ON geography.state FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE geography.city (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    state_id bigint NOT NULL CONSTRAINT fk_city_state REFERENCES geography.state(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_city_state_code UNIQUE (state_id, code)
);
CREATE INDEX idx_city_state ON geography.city(state_id);
CREATE TRIGGER trg_geography_city_updated_at BEFORE UPDATE ON geography.city FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE geography.district (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    city_id bigint NOT NULL CONSTRAINT fk_district_city REFERENCES geography.city(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_district_city_code UNIQUE (city_id, code)
);
CREATE INDEX idx_district_city ON geography.district(city_id);
CREATE TRIGGER trg_geography_district_updated_at BEFORE UPDATE ON geography.district FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE geography.area (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    district_id bigint NOT NULL CONSTRAINT fk_area_district REFERENCES geography.district(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_area_district_code UNIQUE (district_id, code)
);
CREATE INDEX idx_area_district ON geography.area(district_id);
CREATE TRIGGER trg_geography_area_updated_at BEFORE UPDATE ON geography.area FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

-- ============================================================================
-- 4. ORGANIZATION (ORG) SCHEMA
-- ============================================================================
CREATE TABLE org.company (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_company_code UNIQUE,
    name varchar(150) NOT NULL,
    short_name varchar(50),
    legal_name varchar(200),
    address_line1 varchar(150),
    address_line2 varchar(150),
    city_id bigint CONSTRAINT fk_company_city REFERENCES geography.city(id) ON DELETE SET NULL,
    phone varchar(50),
    email varchar(100),
    ntn varchar(30),
    gst_no varchar(30),
    eobi_no varchar(30),
    sessi_no varchar(30),
    logo_path varchar(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_company_city ON org.company(city_id);
CREATE TRIGGER trg_org_company_updated_at BEFORE UPDATE ON org.company FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.branch (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_branch_company REFERENCES org.company(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    city_id bigint CONSTRAINT fk_branch_city REFERENCES geography.city(id) ON DELETE SET NULL,
    address varchar(255),
    phone varchar(50),
    email varchar(100),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_branch_company_code UNIQUE (company_id, code)
);
CREATE INDEX idx_branch_company ON org.branch(company_id);
CREATE INDEX idx_branch_city ON org.branch(city_id);
CREATE TRIGGER trg_org_branch_updated_at BEFORE UPDATE ON org.branch FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.department (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_department_company REFERENCES org.company(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    abbreviation varchar(20),
    cost_center_code varchar(20),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_dept_company_code UNIQUE (company_id, code)
);
CREATE INDEX idx_department_company ON org.department(company_id);
CREATE TRIGGER trg_org_department_updated_at BEFORE UPDATE ON org.department FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.sub_department (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_id bigint NOT NULL CONSTRAINT fk_subdept_department REFERENCES org.department(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_subdept_code UNIQUE (department_id, code)
);
CREATE INDEX idx_subdept_department ON org.sub_department(department_id);
CREATE TRIGGER trg_org_sub_department_updated_at BEFORE UPDATE ON org.sub_department FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.section (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sub_department_id bigint NOT NULL CONSTRAINT fk_section_subdept REFERENCES org.sub_department(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_section_code UNIQUE (sub_department_id, code)
);
CREATE INDEX idx_section_subdept ON org.section(sub_department_id);
CREATE TRIGGER trg_org_section_updated_at BEFORE UPDATE ON org.section FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.grade (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_grade_code UNIQUE,
    name varchar(50) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE TRIGGER trg_org_grade_updated_at BEFORE UPDATE ON org.grade FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.designation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_desg_company REFERENCES org.company(id) ON DELETE RESTRICT,
    grade_id bigint CONSTRAINT fk_desg_grade REFERENCES org.grade(id) ON DELETE SET NULL,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    abbreviation varchar(20),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_desg_company_code UNIQUE (company_id, code)
);
CREATE INDEX idx_desg_company ON org.designation(company_id);
CREATE INDEX idx_desg_grade ON org.designation(grade_id);
CREATE TRIGGER trg_org_designation_updated_at BEFORE UPDATE ON org.designation FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE org.cadre (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_cadre_company REFERENCES org.company(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(50) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_cadre_company_code UNIQUE (company_id, code)
);
CREATE INDEX idx_cadre_company ON org.cadre(company_id);
CREATE TRIGGER trg_org_cadre_updated_at BEFORE UPDATE ON org.cadre FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

-- ============================================================================
-- 5. HUMAN RESOURCES (HR) SCHEMA
-- ============================================================================
CREATE TABLE hr.blood_group (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(10) NOT NULL CONSTRAINT uq_blood_group UNIQUE,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE hr.employee_status (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_emp_status_code UNIQUE,
    name varchar(50) NOT NULL,
    description text,
    is_active_payroll boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE hr.person (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name varchar(50) NOT NULL,
    last_name varchar(50),
    father_name varchar(100),
    gender varchar(10) NOT NULL CONSTRAINT chk_person_gender CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    dob date NOT NULL,
    cnic varchar(20) NOT NULL CONSTRAINT uq_person_cnic UNIQUE,
    cnic_expiry_date date,
    blood_group_id bigint CONSTRAINT fk_person_blood REFERENCES hr.blood_group(id) ON DELETE SET NULL,
    marital_status varchar(20) CONSTRAINT chk_person_marital CHECK (marital_status IN ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED')),
    religion varchar(30),
    permanent_address varchar(255),
    current_address varchar(255),
    mobile_phone varchar(30) NOT NULL,
    personal_email varchar(100),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_person_blood ON hr.person(blood_group_id);
CREATE TRIGGER trg_hr_person_updated_at BEFORE UPDATE ON hr.person FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE hr.employee (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_id bigint NOT NULL CONSTRAINT fk_emp_person REFERENCES hr.person(id) ON DELETE RESTRICT,
    emp_code varchar(30) NOT NULL CONSTRAINT uq_emp_code UNIQUE,
    card_no varchar(30) NOT NULL CONSTRAINT uq_emp_card UNIQUE,
    company_id bigint NOT NULL CONSTRAINT fk_emp_company REFERENCES org.company(id) ON DELETE RESTRICT,
    branch_id bigint NOT NULL CONSTRAINT fk_emp_branch REFERENCES org.branch(id) ON DELETE RESTRICT,
    department_id bigint CONSTRAINT fk_emp_dept REFERENCES org.department(id) ON DELETE RESTRICT,
    sub_department_id bigint CONSTRAINT fk_emp_subdept REFERENCES org.sub_department(id) ON DELETE RESTRICT,
    section_id bigint CONSTRAINT fk_emp_section REFERENCES org.section(id) ON DELETE RESTRICT,
    designation_id bigint CONSTRAINT fk_emp_desg REFERENCES org.designation(id) ON DELETE RESTRICT,
    grade_id bigint CONSTRAINT fk_emp_grade REFERENCES org.grade(id) ON DELETE RESTRICT,
    cadre_id bigint CONSTRAINT fk_emp_cadre REFERENCES org.cadre(id) ON DELETE RESTRICT,
    status_id bigint NOT NULL CONSTRAINT fk_emp_status REFERENCES hr.employee_status(id) ON DELETE RESTRICT,
    manager_id bigint CONSTRAINT fk_emp_manager REFERENCES hr.employee(id) ON DELETE SET NULL,
    hire_date date NOT NULL,
    confirmation_date date,
    probation_months int DEFAULT 3,
    resignation_date date,
    resignation_reason varchar(255),
    exit_date date,
    gross_salary numeric(15, 2) DEFAULT 0.00 NOT NULL,
    basic_salary numeric(15, 2) DEFAULT 0.00 NOT NULL,
    official_email varchar(100),
    profile_photo_path varchar(255),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_emp_person ON hr.employee(person_id);
CREATE INDEX idx_emp_company ON hr.employee(company_id);
CREATE INDEX idx_emp_branch ON hr.employee(branch_id);
CREATE INDEX idx_emp_dept ON hr.employee(department_id);
CREATE INDEX idx_emp_desg ON hr.employee(designation_id);
CREATE INDEX idx_emp_manager ON hr.employee(manager_id);
CREATE TRIGGER trg_hr_employee_updated_at BEFORE UPDATE ON hr.employee FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE hr.bank (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_bank_code UNIQUE,
    name varchar(100) NOT NULL,
    abbreviation varchar(20),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE hr.bank_branch (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bank_id bigint NOT NULL CONSTRAINT fk_bankbrn_bank REFERENCES hr.bank(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(100) NOT NULL,
    address varchar(255),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_bank_branch_code UNIQUE (bank_id, code)
);
CREATE INDEX idx_bankbrn_bank ON hr.bank_branch(bank_id);

CREATE TABLE hr.employee_bank_account (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_empbank_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    bank_branch_id bigint NOT NULL CONSTRAINT fk_empbank_branch REFERENCES hr.bank_branch(id) ON DELETE RESTRICT,
    account_number varchar(50) NOT NULL,
    iban varchar(50),
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_empbank_emp ON hr.employee_bank_account(employee_id);
CREATE INDEX idx_empbank_branch ON hr.employee_bank_account(bank_branch_id);

CREATE TABLE hr.emergency_contact (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_emgcontact_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    relationship varchar(50) NOT NULL,
    mobile_phone varchar(30) NOT NULL,
    cnic varchar(20),
    address varchar(255),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_emgcontact_emp ON hr.emergency_contact(employee_id);

CREATE TABLE hr.family_dependent (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_dependent_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    name varchar(100) NOT NULL,
    relationship varchar(50) NOT NULL CONSTRAINT chk_dependent_rel CHECK (relationship IN ('SPOUSE', 'CHILD', 'PARENT')),
    dob date,
    cnic_or_bform varchar(30),
    gender varchar(10) CONSTRAINT chk_dependent_gender CHECK (gender IN ('MALE', 'FEMALE')),
    is_medical_covered boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_dependent_emp ON hr.family_dependent(employee_id);

CREATE TABLE hr.work_experience (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_workexp_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    company_name varchar(150) NOT NULL,
    designation varchar(100) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    gross_salary numeric(15, 2),
    reason_for_leaving varchar(255),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_workexp_emp ON hr.work_experience(employee_id);

CREATE TABLE hr.qualification (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_qual_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    degree_level varchar(50) NOT NULL,
    degree_title varchar(150) NOT NULL,
    institution varchar(200) NOT NULL,
    passing_year int NOT NULL,
    grade_or_gpa varchar(20),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_qual_emp ON hr.qualification(employee_id);

CREATE TABLE hr.credential (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_cred_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    ntn varchar(30),
    eobi_number varchar(30),
    sessi_number varchar(30),
    passport_number varchar(30),
    passport_expiry_date date,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_cred_emp ON hr.credential(employee_id);

CREATE TABLE hr.document (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_doc_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    document_type varchar(50) NOT NULL,
    file_name varchar(255) NOT NULL,
    file_path varchar(500) NOT NULL,
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_doc_emp ON hr.document(employee_id);

CREATE TABLE hr.tracking_setting (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_track_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    is_tracking_enabled boolean DEFAULT true NOT NULL,
    fixed_location_only boolean DEFAULT false NOT NULL,
    default_latitude numeric(10, 8),
    default_longitude numeric(11, 8),
    allowed_margin_meters int DEFAULT 100,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_tracking_employee UNIQUE (employee_id)
);

CREATE TABLE hr.approval_level (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_appr_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    approval_level_number int NOT NULL CONSTRAINT chk_approval_level CHECK (approval_level_number IN (1, 2, 3)),
    approver_employee_id bigint NOT NULL CONSTRAINT fk_appr_approver REFERENCES hr.employee(id) ON DELETE RESTRICT,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_emp_approval_level UNIQUE (employee_id, approval_level_number)
);
CREATE INDEX idx_appr_emp ON hr.approval_level(employee_id);
CREATE INDEX idx_appr_approver ON hr.approval_level(approver_employee_id);

CREATE TABLE hr.status_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_statushist_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    old_status_id bigint CONSTRAINT fk_statushist_old REFERENCES hr.employee_status(id),
    new_status_id bigint NOT NULL CONSTRAINT fk_statushist_new REFERENCES hr.employee_status(id),
    effective_date date NOT NULL,
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);
CREATE INDEX idx_statushist_emp ON hr.status_history(employee_id);

-- ============================================================================
-- 6. AUTHENTICATION & ACCESS CONTROL (RBAC) SCHEMAS
-- ============================================================================
CREATE TABLE auth.app_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username varchar(50) NOT NULL CONSTRAINT uq_app_user_name UNIQUE,
    email varchar(100) NOT NULL CONSTRAINT uq_app_user_email UNIQUE,
    password_hash varchar(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_hr_admin boolean DEFAULT false NOT NULL,
    person_id bigint CONSTRAINT fk_user_person REFERENCES hr.person(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_user_person ON auth.app_user(person_id);
CREATE TRIGGER trg_auth_app_user_updated_at BEFORE UPDATE ON auth.app_user FOR EACH ROW EXECUTE FUNCTION audit.set_updated_at();

CREATE TABLE access_control.role (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(50) NOT NULL CONSTRAINT uq_role_code UNIQUE,
    name varchar(100) NOT NULL,
    description text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE access_control.permission (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(100) NOT NULL CONSTRAINT uq_perm_code UNIQUE,
    name varchar(150) NOT NULL,
    module varchar(50) NOT NULL,
    description text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE access_control.role_permission (
    role_id bigint NOT NULL CONSTRAINT fk_rp_role REFERENCES access_control.role(id) ON DELETE CASCADE,
    permission_id bigint NOT NULL CONSTRAINT fk_rp_perm REFERENCES access_control.permission(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_rp_perm ON access_control.role_permission(permission_id);

CREATE TABLE access_control.user_role (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL CONSTRAINT fk_ur_user REFERENCES auth.app_user(id) ON DELETE CASCADE,
    role_id bigint NOT NULL CONSTRAINT fk_ur_role REFERENCES access_control.role(id) ON DELETE CASCADE,
    company_id bigint CONSTRAINT fk_ur_company REFERENCES org.company(id) ON DELETE CASCADE,
    branch_id bigint CONSTRAINT fk_ur_branch REFERENCES org.branch(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_user_role_scope UNIQUE (user_id, role_id, company_id, branch_id)
);
CREATE INDEX idx_ur_user ON access_control.user_role(user_id);
CREATE INDEX idx_ur_role ON access_control.user_role(role_id);

-- ============================================================================
-- 7. ATTENDANCE SCHEMA
-- ============================================================================
CREATE TABLE attendance.shift_schedule (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_shift_company REFERENCES org.company(id) ON DELETE RESTRICT,
    branch_id bigint CONSTRAINT fk_shift_branch REFERENCES org.branch(id) ON DELETE RESTRICT,
    shift_code varchar(10) NOT NULL,
    shift_name varchar(50) NOT NULL,
    start_time time NOT NULL,
    end_time time NOT NULL,
    allow_in_time time,
    late_start_time time,
    late_end_time time,
    half_day_time time,
    half_day_end_time time,
    early_out_late_start time,
    early_out_late_end time,
    early_out_hday_start time,
    early_out_hday_end time,
    duty_hours numeric(4, 2) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_shift_company_code UNIQUE (company_id, shift_code)
);
CREATE INDEX idx_shift_company ON attendance.shift_schedule(company_id);

CREATE TABLE attendance.attendance_period (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_attperiod_company REFERENCES org.company(id) ON DELETE RESTRICT,
    period_number int NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    status varchar(20) DEFAULT 'OPEN' NOT NULL CONSTRAINT chk_attperiod_status CHECK (status IN ('OPEN', 'CLOSED', 'PROCESSING')),
    is_blocked boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_attperiod_company_num UNIQUE (company_id, period_number)
);

CREATE TABLE attendance.biometric_device (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_bio_company REFERENCES org.company(id) ON DELETE RESTRICT,
    branch_id bigint NOT NULL CONSTRAINT fk_bio_branch REFERENCES org.branch(id) ON DELETE RESTRICT,
    device_name varchar(100) NOT NULL,
    device_ip varchar(45) NOT NULL,
    terminal_id varchar(50),
    serial_number varchar(100),
    location_description varchar(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE attendance.duty_status (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(20) NOT NULL CONSTRAINT uq_duty_status_code UNIQUE,
    name varchar(50) NOT NULL,
    description text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE attendance.duty_roster (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_roster_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    roster_date date NOT NULL,
    shift_id bigint NOT NULL CONSTRAINT fk_roster_shift REFERENCES attendance.shift_schedule(id) ON DELETE RESTRICT,
    arrival_status varchar(20) DEFAULT 'ON_TIME' CONSTRAINT chk_arrival_status CHECK (arrival_status IN ('ON_TIME', 'LATE', 'HALF_DAY_LATE', 'ABSENT')),
    departure_status varchar(20) DEFAULT 'ON_TIME' CONSTRAINT chk_departure_status CHECK (departure_status IN ('ON_TIME', 'EARLY_OUT', 'HALF_DAY_EARLY', 'OVERTIME')),
    duty_hours numeric(4, 2) DEFAULT 8.00 NOT NULL,
    late_minutes int DEFAULT 0 NOT NULL,
    early_out_minutes int DEFAULT 0 NOT NULL,
    overtime_minutes int DEFAULT 0 NOT NULL,
    leave_application_id bigint,
    remarks varchar(255),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_emp_roster_date UNIQUE (employee_id, roster_date)
);
CREATE INDEX idx_roster_emp ON attendance.duty_roster(employee_id);
CREATE INDEX idx_roster_date ON attendance.duty_roster(roster_date);

CREATE TABLE attendance.attendance_record (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_attrec_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    attendance_date date NOT NULL,
    check_in_time timestamptz,
    check_out_time timestamptz,
    check_in_latitude numeric(10, 8),
    check_in_longitude numeric(11, 8),
    check_in_address varchar(400),
    check_out_latitude numeric(10, 8),
    check_out_longitude numeric(11, 8),
    check_out_address varchar(400),
    device_id bigint CONSTRAINT fk_attrec_device REFERENCES attendance.biometric_device(id) ON DELETE SET NULL,
    device_info jsonb,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_emp_attendance_date UNIQUE (employee_id, attendance_date)
);
CREATE INDEX idx_attrec_emp ON attendance.attendance_record(employee_id);
CREATE INDEX idx_attrec_date ON attendance.attendance_record(attendance_date);

CREATE TABLE attendance.raw_punch_data (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_rawpunch_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    punch_time timestamptz NOT NULL,
    punch_type varchar(10) NOT NULL CONSTRAINT chk_punch_type CHECK (punch_type IN ('IN', 'OUT', 'BREAK_IN', 'BREAK_OUT')),
    device_id bigint CONSTRAINT fk_rawpunch_device REFERENCES attendance.biometric_device(id) ON DELETE SET NULL,
    is_processed boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_rawpunch_emp ON attendance.raw_punch_data(employee_id);

CREATE TABLE attendance.overtime_approval (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_otappr_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    roster_date date NOT NULL,
    requested_minutes int NOT NULL,
    approved_minutes int NOT NULL,
    approved_by bigint NOT NULL CONSTRAINT fk_otappr_approver REFERENCES hr.employee(id) ON DELETE RESTRICT,
    status varchar(20) DEFAULT 'PENDING' NOT NULL CONSTRAINT chk_otappr_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE attendance.location_track (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_loctrack_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    recorded_at timestamptz NOT NULL,
    latitude numeric(10, 8) NOT NULL,
    longitude numeric(11, 8) NOT NULL,
    accuracy numeric(8, 2),
    attendance_date date NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_loctrack_emp ON attendance.location_track(employee_id);
CREATE INDEX idx_loctrack_recorded ON attendance.location_track(recorded_at);

-- ============================================================================
-- 8. LEAVE MANAGEMENT (LEAVE_MGMT) SCHEMA
-- ============================================================================
CREATE TABLE leave_mgmt.leave_type (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_lt_company REFERENCES org.company(id) ON DELETE RESTRICT,
    code varchar(10) NOT NULL,
    name varchar(50) NOT NULL,
    description text,
    is_encashable boolean DEFAULT false NOT NULL,
    is_carry_forward boolean DEFAULT false NOT NULL,
    max_carry_forward_days int DEFAULT 0,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_leavetype_company_code UNIQUE (company_id, code)
);

CREATE TABLE leave_mgmt.leave_type_entitlement (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_type_id bigint NOT NULL CONSTRAINT fk_lte_leavetype REFERENCES leave_mgmt.leave_type(id) ON DELETE CASCADE,
    grade_id bigint NOT NULL CONSTRAINT fk_lte_grade REFERENCES org.grade(id) ON DELETE CASCADE,
    annual_days int NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_lte_type_grade UNIQUE (leave_type_id, grade_id)
);

CREATE TABLE leave_mgmt.entitlement_rule (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_type_id bigint NOT NULL CONSTRAINT fk_er_leavetype REFERENCES leave_mgmt.leave_type(id) ON DELETE CASCADE,
    min_service_months int DEFAULT 0 NOT NULL,
    gender_applicability varchar(10) DEFAULT 'ALL' NOT NULL CONSTRAINT chk_er_gender CHECK (gender_applicability IN ('ALL', 'MALE', 'FEMALE')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE leave_mgmt.holiday (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_holiday_company REFERENCES org.company(id) ON DELETE CASCADE,
    branch_id bigint CONSTRAINT fk_holiday_branch REFERENCES org.branch(id) ON DELETE CASCADE,
    title varchar(100) NOT NULL,
    holiday_date date NOT NULL,
    is_recurring boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE leave_mgmt.leave_balance (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_lbal_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    leave_type_id bigint NOT NULL CONSTRAINT fk_lbal_leavetype REFERENCES leave_mgmt.leave_type(id) ON DELETE RESTRICT,
    year int NOT NULL,
    previous_balance numeric(5, 2) DEFAULT 0.00 NOT NULL,
    new_entitled numeric(5, 2) DEFAULT 0.00 NOT NULL,
    total_available numeric(5, 2) DEFAULT 0.00 NOT NULL,
    availed numeric(5, 2) DEFAULT 0.00 NOT NULL,
    current_balance numeric(5, 2) DEFAULT 0.00 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_emp_leavetype_year UNIQUE (employee_id, leave_type_id, year)
);
CREATE INDEX idx_lbal_emp ON leave_mgmt.leave_balance(employee_id);

CREATE TABLE leave_mgmt.leave_application (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_lapp_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    leave_type_id bigint NOT NULL CONSTRAINT fk_lapp_leavetype REFERENCES leave_mgmt.leave_type(id) ON DELETE RESTRICT,
    start_date date NOT NULL,
    end_date date NOT NULL,
    leave_days numeric(5, 2) NOT NULL,
    is_half_day boolean DEFAULT false NOT NULL,
    reason varchar(255) NOT NULL,
    approval_status varchar(20) DEFAULT 'PENDING' NOT NULL CONSTRAINT chk_lapp_status CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    approved_by bigint CONSTRAINT fk_lapp_approver REFERENCES hr.employee(id) ON DELETE SET NULL,
    approval_date timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_lapp_emp ON leave_mgmt.leave_application(employee_id);
ALTER TABLE attendance.duty_roster ADD CONSTRAINT fk_roster_leaveapp FOREIGN KEY (leave_application_id) REFERENCES leave_mgmt.leave_application(id) ON DELETE SET NULL;

CREATE TABLE leave_mgmt.balance_adjustment_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    leave_balance_id bigint NOT NULL CONSTRAINT fk_laudit_bal REFERENCES leave_mgmt.leave_balance(id) ON DELETE CASCADE,
    adjustment_days numeric(5, 2) NOT NULL,
    adjustment_reason varchar(255) NOT NULL,
    adjusted_by bigint NOT NULL CONSTRAINT fk_laudit_user REFERENCES auth.app_user(id),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- 9. PAYROLL SCHEMA
-- ============================================================================
CREATE TABLE payroll.allowance_type (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_allow_code UNIQUE,
    name varchar(100) NOT NULL,
    is_taxable boolean DEFAULT true NOT NULL,
    is_eobi_included boolean DEFAULT true NOT NULL,
    is_sessi_included boolean DEFAULT true NOT NULL,
    is_gross_included boolean DEFAULT true NOT NULL,
    use_frequency varchar(10) DEFAULT 'MONTHLY' NOT NULL CONSTRAINT chk_allow_freq CHECK (use_frequency IN ('MONTHLY', 'FIXED', 'ANNUAL')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE payroll.deduction_type (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_ded_code UNIQUE,
    name varchar(100) NOT NULL,
    is_statutory boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE payroll.salary_formula_parameter (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    param_code varchar(50) NOT NULL CONSTRAINT uq_sfp_code UNIQUE,
    param_name varchar(100) NOT NULL,
    numeric_value numeric(15, 4),
    text_value varchar(255),
    description text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE payroll.salary_component_rule (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    component_type varchar(15) NOT NULL CONSTRAINT chk_scr_type CHECK (component_type IN ('ALLOWANCE', 'DEDUCTION')),
    component_id bigint NOT NULL,
    calculation_basis varchar(30) NOT NULL CONSTRAINT chk_scr_basis CHECK (calculation_basis IN ('FLAT', 'PERCENTAGE_BASIC', 'PERCENTAGE_GROSS')),
    percentage_or_amount numeric(15, 4) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE payroll.loan_type (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(10) NOT NULL CONSTRAINT uq_loantype_code UNIQUE,
    name varchar(100) NOT NULL,
    interest_rate numeric(5, 2) DEFAULT 0.00 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE payroll.employee_loan (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_emploan_emp REFERENCES hr.employee(id) ON DELETE RESTRICT,
    loan_type_id bigint NOT NULL CONSTRAINT fk_emploan_type REFERENCES payroll.loan_type(id) ON DELETE RESTRICT,
    application_date date NOT NULL,
    loan_amount numeric(15, 2) NOT NULL,
    installment_amount numeric(15, 2) NOT NULL,
    total_installments int NOT NULL,
    start_date date NOT NULL,
    remaining_amount numeric(15, 2) NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);
CREATE INDEX idx_emploan_emp ON payroll.employee_loan(employee_id);

CREATE TABLE payroll.loan_recovery (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_loan_id bigint NOT NULL CONSTRAINT fk_loanrec_loan REFERENCES payroll.employee_loan(id) ON DELETE CASCADE,
    period_id bigint NOT NULL CONSTRAINT fk_loanrec_period REFERENCES attendance.attendance_period(id) ON DELETE RESTRICT,
    recovered_amount numeric(15, 2) NOT NULL,
    balance_after_recovery numeric(15, 2) NOT NULL,
    recovery_type varchar(20) DEFAULT 'SALARY' NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);

CREATE TABLE payroll.tax_slab_set (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fiscal_year varchar(10) NOT NULL,
    title varchar(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_taxslabset_fy UNIQUE (fiscal_year, title)
);

CREATE TABLE payroll.tax_slab (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slab_set_id bigint NOT NULL CONSTRAINT fk_tslab_set REFERENCES payroll.tax_slab_set(id) ON DELETE CASCADE,
    slab_number int NOT NULL,
    slab_from numeric(15, 2) NOT NULL,
    slab_to numeric(15, 2) NOT NULL,
    slab_rate numeric(5, 2) NOT NULL,
    fixed_tax_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_tslab_num UNIQUE (slab_set_id, slab_number)
);

CREATE TABLE payroll.salary_run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_salrun_company REFERENCES org.company(id) ON DELETE RESTRICT,
    period_id bigint NOT NULL CONSTRAINT fk_salrun_period REFERENCES attendance.attendance_period(id) ON DELETE RESTRICT,
    run_date timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    total_employees int NOT NULL,
    total_gross numeric(15, 2) NOT NULL,
    total_net numeric(15, 2) NOT NULL,
    status varchar(20) DEFAULT 'DRAFT' NOT NULL CONSTRAINT chk_salrun_status CHECK (status IN ('DRAFT', 'CALCULATED', 'POSTED', 'CANCELLED')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_salrun_company_period UNIQUE (company_id, period_id)
);

CREATE TABLE payroll.salary_run_allowance (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    salary_run_id bigint NOT NULL CONSTRAINT fk_salallow_run REFERENCES payroll.salary_run(id) ON DELETE CASCADE,
    employee_id bigint NOT NULL CONSTRAINT fk_salallow_emp REFERENCES hr.employee(id) ON DELETE RESTRICT,
    allowance_type_id bigint NOT NULL CONSTRAINT fk_salallow_type REFERENCES payroll.allowance_type(id) ON DELETE RESTRICT,
    amount numeric(15, 2) NOT NULL,
    ot_hours numeric(5, 2) DEFAULT 0.00,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);
CREATE INDEX idx_salallow_run ON payroll.salary_run_allowance(salary_run_id);
CREATE INDEX idx_salallow_emp ON payroll.salary_run_allowance(employee_id);

CREATE TABLE payroll.salary_run_deduction (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    salary_run_id bigint NOT NULL CONSTRAINT fk_salded_run REFERENCES payroll.salary_run(id) ON DELETE CASCADE,
    employee_id bigint NOT NULL CONSTRAINT fk_salded_emp REFERENCES hr.employee(id) ON DELETE RESTRICT,
    deduction_type_id bigint NOT NULL CONSTRAINT fk_salded_type REFERENCES payroll.deduction_type(id) ON DELETE RESTRICT,
    amount numeric(15, 2) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);
CREATE INDEX idx_salded_run ON payroll.salary_run_deduction(salary_run_id);
CREATE INDEX idx_salded_emp ON payroll.salary_run_deduction(employee_id);

CREATE TABLE payroll.salary_increment (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_inc_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    effective_date date NOT NULL,
    previous_gross numeric(15, 2) NOT NULL,
    new_gross numeric(15, 2) NOT NULL,
    previous_basic numeric(15, 2) NOT NULL,
    new_basic numeric(15, 2) NOT NULL,
    increment_reason varchar(255),
    approved_by bigint CONSTRAINT fk_inc_approver REFERENCES hr.employee(id),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);

CREATE TABLE payroll.tax_rebate (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_rebate_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    period_id bigint NOT NULL CONSTRAINT fk_rebate_period REFERENCES attendance.attendance_period(id),
    rebate_type varchar(50) NOT NULL,
    rebate_amount numeric(15, 2) NOT NULL,
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);

CREATE TABLE payroll.pf_eobi_contribution (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    salary_run_id bigint NOT NULL CONSTRAINT fk_pfeobi_run REFERENCES payroll.salary_run(id) ON DELETE CASCADE,
    employee_id bigint NOT NULL CONSTRAINT fk_pfeobi_emp REFERENCES hr.employee(id),
    employee_pf_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    employer_pf_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    employee_eobi_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    employer_eobi_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- 10. RECRUITMENT SCHEMA
-- ============================================================================
CREATE TABLE recruitment.job (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_recjob_company REFERENCES org.company(id) ON DELETE RESTRICT,
    branch_id bigint CONSTRAINT fk_recjob_branch REFERENCES org.branch(id) ON DELETE RESTRICT,
    department_id bigint CONSTRAINT fk_recjob_dept REFERENCES org.department(id) ON DELETE RESTRICT,
    job_title varchar(150) NOT NULL,
    open_positions int DEFAULT 1 NOT NULL,
    job_description text NOT NULL,
    required_skills text,
    status varchar(20) DEFAULT 'OPEN' NOT NULL CONSTRAINT chk_recjob_status CHECK (status IN ('DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE recruitment.candidate (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name varchar(150) NOT NULL,
    email varchar(100) NOT NULL CONSTRAINT uq_cand_email UNIQUE,
    mobile_phone varchar(30) NOT NULL,
    source varchar(50),
    resume_path varchar(500),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE recruitment.candidate_education (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id bigint NOT NULL CONSTRAINT fk_candeduc_cand REFERENCES recruitment.candidate(id) ON DELETE CASCADE,
    degree_title varchar(150) NOT NULL,
    institution varchar(200) NOT NULL,
    passing_year int NOT NULL,
    gpa varchar(20),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE recruitment.candidate_experience (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id bigint NOT NULL CONSTRAINT fk_candexp_cand REFERENCES recruitment.candidate(id) ON DELETE CASCADE,
    company_name varchar(150) NOT NULL,
    designation varchar(100) NOT NULL,
    duration_years numeric(4, 1) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE recruitment.candidate_skill (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidate_id bigint NOT NULL CONSTRAINT fk_candskill_cand REFERENCES recruitment.candidate(id) ON DELETE CASCADE,
    skill_name varchar(100) NOT NULL,
    proficiency_level varchar(30),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE recruitment.application (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id bigint NOT NULL CONSTRAINT fk_recapp_job REFERENCES recruitment.job(id) ON DELETE RESTRICT,
    candidate_id bigint NOT NULL CONSTRAINT fk_recapp_cand REFERENCES recruitment.candidate(id) ON DELETE RESTRICT,
    application_date date DEFAULT CURRENT_DATE NOT NULL,
    status varchar(30) DEFAULT 'APPLIED' NOT NULL CONSTRAINT chk_recapp_status CHECK (status IN ('APPLIED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'OFFERED', 'REJECTED', 'HIRED')),
    notes text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_cand_job_app UNIQUE (job_id, candidate_id)
);

CREATE TABLE recruitment.interview_type (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint CONSTRAINT fk_inttype_company REFERENCES org.company(id) ON DELETE CASCADE,
    name varchar(50) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE recruitment.interview (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id bigint NOT NULL CONSTRAINT fk_interview_app REFERENCES recruitment.application(id) ON DELETE CASCADE,
    interview_type_id bigint NOT NULL CONSTRAINT fk_interview_type REFERENCES recruitment.interview_type(id) ON DELETE RESTRICT,
    scheduled_date timestamptz NOT NULL,
    mode varchar(20) DEFAULT 'IN_PERSON' NOT NULL CONSTRAINT chk_int_mode CHECK (mode IN ('IN_PERSON', 'ONLINE_VIDEO', 'PHONE')),
    location_or_link varchar(300),
    status varchar(20) DEFAULT 'SCHEDULED' NOT NULL CONSTRAINT chk_int_status CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
    feedback text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE recruitment.interview_panel_pool (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_panel_company REFERENCES org.company(id) ON DELETE RESTRICT,
    branch_id bigint NOT NULL CONSTRAINT fk_panel_branch REFERENCES org.branch(id) ON DELETE RESTRICT,
    employee_id bigint NOT NULL CONSTRAINT fk_panel_emp REFERENCES hr.employee(id) ON DELETE CASCADE,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    CONSTRAINT uq_panel_pool UNIQUE (company_id, branch_id, employee_id)
);

CREATE TABLE recruitment.interview_assignment (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    interview_id bigint NOT NULL CONSTRAINT fk_intassign_interview REFERENCES recruitment.interview(id) ON DELETE CASCADE,
    interviewer_employee_id bigint NOT NULL CONSTRAINT fk_intassign_emp REFERENCES hr.employee(id) ON DELETE RESTRICT,
    start_time time NOT NULL,
    end_time time NOT NULL,
    status varchar(20) DEFAULT 'PENDING' NOT NULL CONSTRAINT chk_intassign_status CHECK (status IN ('PENDING', 'CONDUCTED', 'SKIPPED')),
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    CONSTRAINT uq_int_interviewer UNIQUE (interview_id, interviewer_employee_id)
);

CREATE TABLE recruitment.offer (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id bigint NOT NULL CONSTRAINT fk_offer_app REFERENCES recruitment.application(id) ON DELETE CASCADE,
    offer_date date NOT NULL,
    salary_offered numeric(15, 2) NOT NULL,
    status varchar(20) DEFAULT 'OFFERED' NOT NULL CONSTRAINT chk_offer_status CHECK (status IN ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
    notes text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_offer_application UNIQUE (application_id)
);

CREATE TABLE recruitment.ai_evaluation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id bigint NOT NULL CONSTRAINT fk_aieval_app REFERENCES recruitment.application(id) ON DELETE CASCADE,
    fit_score numeric(5, 2) NOT NULL CONSTRAINT chk_aieval_score CHECK (fit_score BETWEEN 0 AND 100),
    summary text NOT NULL,
    recommendation varchar(30) NOT NULL CONSTRAINT chk_aieval_rec CHECK (recommendation IN ('STRONG_NO_HIRE', 'NO_HIRE', 'NEUTRAL', 'HIRE', 'STRONG_HIRE')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    CONSTRAINT uq_aieval_application UNIQUE (application_id)
);

CREATE TABLE recruitment.ai_strength (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evaluation_id bigint NOT NULL CONSTRAINT fk_aistr_eval REFERENCES recruitment.ai_evaluation(id) ON DELETE CASCADE,
    strength_text text NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE recruitment.ai_weakness (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evaluation_id bigint NOT NULL CONSTRAINT fk_aiweak_eval REFERENCES recruitment.ai_evaluation(id) ON DELETE CASCADE,
    weakness_text text NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE recruitment.recruitment_setting (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_recset_company REFERENCES org.company(id) ON DELETE CASCADE,
    setting_key varchar(100) NOT NULL,
    setting_value text NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_recset_key UNIQUE (company_id, setting_key)
);

-- ============================================================================
-- 11. NOTIFICATION SCHEMA
-- ============================================================================
CREATE TABLE notification.message_template (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_name varchar(100) NOT NULL CONSTRAINT uq_template_name UNIQUE,
    channel varchar(20) NOT NULL CONSTRAINT chk_template_channel CHECK (channel IN ('EMAIL', 'WHATSAPP', 'SMS', 'PUSH')),
    recipient_type varchar(30) NOT NULL CONSTRAINT chk_template_recipient CHECK (recipient_type IN ('CANDIDATE', 'INTERVIEWER', 'EMPLOYEE', 'ADMIN')),
    event_type varchar(50) NOT NULL,
    subject varchar(200),
    body_template text NOT NULL,
    placeholders jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE notification.message_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id bigint CONSTRAINT fk_msgq_template REFERENCES notification.message_template(id) ON DELETE SET NULL,
    recipient_contact varchar(150) NOT NULL,
    message_body text NOT NULL,
    scheduled_for timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    attempts int DEFAULT 0 NOT NULL,
    status varchar(20) DEFAULT 'PENDING' NOT NULL CONSTRAINT chk_msgq_status CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_msgq_status ON notification.message_queue(status);

CREATE TABLE notification.message_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    template_id bigint CONSTRAINT fk_msglog_template REFERENCES notification.message_template(id) ON DELETE SET NULL,
    recipient_contact varchar(150) NOT NULL,
    message_body text NOT NULL,
    sent_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status varchar(20) NOT NULL,
    error_message text
);

CREATE TABLE notification.smtp_setting (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    host varchar(150) NOT NULL,
    port int NOT NULL,
    username varchar(100) NOT NULL,
    password_hash varchar(255) NOT NULL,
    encryption_type varchar(10) DEFAULT 'TLS' NOT NULL CONSTRAINT chk_smtp_enc CHECK (encryption_type IN ('NONE', 'SSL', 'TLS')),
    sender_email varchar(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

-- ============================================================================
-- 12. BENEFITS SCHEMA
-- ============================================================================
CREATE TABLE benefits.lfa_claim (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_lfa_emp REFERENCES hr.employee(id) ON DELETE RESTRICT,
    period_id bigint NOT NULL CONSTRAINT fk_lfa_period REFERENCES attendance.attendance_period(id) ON DELETE RESTRICT,
    claim_amount numeric(15, 2) NOT NULL,
    approved_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    status varchar(20) DEFAULT 'SUBMITTED' NOT NULL CONSTRAINT chk_lfa_status CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID')),
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE benefits.opd_medical_claim (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id bigint NOT NULL CONSTRAINT fk_opd_emp REFERENCES hr.employee(id) ON DELETE RESTRICT,
    dependent_id bigint CONSTRAINT fk_opd_dependent REFERENCES hr.family_dependent(id) ON DELETE SET NULL,
    claim_date date NOT NULL,
    prescription_details text,
    claim_amount numeric(15, 2) NOT NULL,
    approved_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    status varchar(20) DEFAULT 'SUBMITTED' NOT NULL CONSTRAINT chk_opd_status CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID')),
    remarks text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

-- ============================================================================
-- 13. BUDGET SCHEMA
-- ============================================================================
CREATE TABLE budget.hr_budget (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_hrb_company REFERENCES org.company(id) ON DELETE RESTRICT,
    fiscal_year varchar(10) NOT NULL,
    total_budgeted_amount numeric(15, 2) NOT NULL,
    description text,
    status varchar(20) DEFAULT 'DRAFT' NOT NULL CONSTRAINT chk_hrb_status CHECK (status IN ('DRAFT', 'APPROVED', 'LOCKED')),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_hrb_company_fy UNIQUE (company_id, fiscal_year)
);

CREATE TABLE budget.department_budget (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hr_budget_id bigint NOT NULL CONSTRAINT fk_deptb_hrb REFERENCES budget.hr_budget(id) ON DELETE CASCADE,
    department_id bigint NOT NULL CONSTRAINT fk_deptb_dept REFERENCES org.department(id) ON DELETE RESTRICT,
    allocated_amount numeric(15, 2) NOT NULL,
    spent_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    remaining_amount numeric(15, 2) GENERATED ALWAYS AS (allocated_amount - spent_amount) STORED,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_deptb_budget_dept UNIQUE (hr_budget_id, department_id)
);

-- ============================================================================
-- 14. FINANCE SCHEMA
-- ============================================================================
CREATE TABLE finance.chart_of_accounts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_coa_company REFERENCES org.company(id) ON DELETE RESTRICT,
    account_code varchar(30) NOT NULL,
    account_name varchar(150) NOT NULL,
    account_type varchar(30) NOT NULL CONSTRAINT chk_coa_type CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_coa_company_code UNIQUE (company_id, account_code)
);

CREATE TABLE finance.currency (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code varchar(5) NOT NULL CONSTRAINT uq_curr_code UNIQUE,
    name varchar(50) NOT NULL,
    symbol varchar(5),
    exchange_rate numeric(12, 6) DEFAULT 1.000000 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL
);

CREATE TABLE finance.supplier (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_supp_company REFERENCES org.company(id) ON DELETE RESTRICT,
    code varchar(20) NOT NULL,
    name varchar(150) NOT NULL,
    ntn varchar(30),
    address varchar(255),
    phone varchar(50),
    email varchar(100),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by bigint NOT NULL,
    CONSTRAINT uq_supp_company_code UNIQUE (company_id, code)
);

CREATE TABLE finance.general_ledger (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id bigint NOT NULL CONSTRAINT fk_gl_company REFERENCES org.company(id) ON DELETE RESTRICT,
    account_id bigint NOT NULL CONSTRAINT fk_gl_account REFERENCES finance.chart_of_accounts(id) ON DELETE RESTRICT,
    voucher_number varchar(50) NOT NULL,
    voucher_date date NOT NULL,
    debit_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    credit_amount numeric(15, 2) DEFAULT 0.00 NOT NULL,
    narration text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by bigint NOT NULL
);
CREATE INDEX idx_gl_account ON finance.general_ledger(account_id);
CREATE INDEX idx_gl_voucher ON finance.general_ledger(voucher_number);

-- ============================================================================
-- 15. DOCUMENTATION COMMENTS
-- ============================================================================
COMMENT ON SCHEMA audit IS 'Functions and objects for auditing changes.';
COMMENT ON SCHEMA auth IS 'Core user authentication credentials.';
COMMENT ON SCHEMA access_control IS 'Role-Based Access Control (RBAC) permissions model.';
COMMENT ON SCHEMA geography IS 'Geographic hierarchy (countries, states, cities, districts, areas).';
COMMENT ON SCHEMA org IS 'Organizational structures (company, branch, dept, subdept, section, grade, desg, cadre).';
COMMENT ON SCHEMA hr IS 'Employee master demographics, contacts, dependents, qualifications, and accounts.';
COMMENT ON SCHEMA attendance IS 'Shifts, rosters, raw punches, biometric devices, and processed attendance records.';
COMMENT ON SCHEMA leave_mgmt IS 'Leave types, entitlements, balances, applications, and holiday calendars.';
COMMENT ON SCHEMA payroll IS 'Salary components, loans, tax slabs, payroll runs, increments, and EOBI/PF.';
COMMENT ON SCHEMA recruitment IS 'Job requisitions, candidates, AI evaluations, interviews, and offers.';
COMMENT ON SCHEMA notification IS 'Message templates, delivery log, queue, and SMTP settings.';
COMMENT ON SCHEMA benefits IS 'LFA and OPD medical claims management.';
COMMENT ON SCHEMA budget IS 'HR and departmental budgeting allocations.';
COMMENT ON SCHEMA finance IS 'Chart of accounts, currencies, suppliers, and GL ledger entries.';

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================
