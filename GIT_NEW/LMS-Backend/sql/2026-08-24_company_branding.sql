-- ============================================================
-- HR_COMPANY_BRANDING — per-company ID-card footer + QR target
-- ------------------------------------------------------------
-- The employee ID card used to hard-code the Sysnovix QR/footer.
-- It now reads these rows by HR_EMP_MASTER.UNIT_ID and generates the
-- QR from QR_URL at render time. A company with no row here keeps the
-- Sysnovix default, so this script is safe to run at any time.
--
-- SHOW_ON_CARD = 'N' prints the card with no vendor block at all.
-- ============================================================

CREATE TABLE HR_COMPANY_BRANDING (
    UNIT_ID       NUMBER        PRIMARY KEY,
    BRAND_NAME    VARCHAR2(120) NOT NULL,
    TAGLINE       VARCHAR2(120),
    WEBSITE       VARCHAR2(200),
    QR_URL        VARCHAR2(400),
    PHONE         VARCHAR2(60),
    EMAIL         VARCHAR2(120),
    SHOW_ON_CARD  VARCHAR2(1)   DEFAULT 'Y'
);

-- Companies 1–4: the existing Sysnovix branding.
INSERT INTO HR_COMPANY_BRANDING (UNIT_ID, BRAND_NAME, TAGLINE, WEBSITE, QR_URL, PHONE, EMAIL, SHOW_ON_CARD)
VALUES (1, 'Sysnovix', 'ERP & IT Solutions', 'sysnovix.com', 'https://sysnovix.com', '+92 370 3677800', 'info@sysnovix.com', 'Y');
INSERT INTO HR_COMPANY_BRANDING (UNIT_ID, BRAND_NAME, TAGLINE, WEBSITE, QR_URL, PHONE, EMAIL, SHOW_ON_CARD)
VALUES (2, 'Sysnovix', 'ERP & IT Solutions', 'sysnovix.com', 'https://sysnovix.com', '+92 370 3677800', 'info@sysnovix.com', 'Y');
INSERT INTO HR_COMPANY_BRANDING (UNIT_ID, BRAND_NAME, TAGLINE, WEBSITE, QR_URL, PHONE, EMAIL, SHOW_ON_CARD)
VALUES (3, 'Sysnovix', 'ERP & IT Solutions', 'sysnovix.com', 'https://sysnovix.com', '+92 370 3677800', 'info@sysnovix.com', 'Y');
INSERT INTO HR_COMPANY_BRANDING (UNIT_ID, BRAND_NAME, TAGLINE, WEBSITE, QR_URL, PHONE, EMAIL, SHOW_ON_CARD)
VALUES (4, 'Sysnovix', 'ERP & IT Solutions', 'sysnovix.com', 'https://sysnovix.com', '+92 370 3677800', 'info@sysnovix.com', 'Y');

-- Company 5: Shaykho — its own QR (generated from QR_URL) and details.
-- PHONE/EMAIL left NULL; fill them in and the card picks them up on the next
-- print (cached for 5 minutes server-side).
INSERT INTO HR_COMPANY_BRANDING (UNIT_ID, BRAND_NAME, TAGLINE, WEBSITE, QR_URL, PHONE, EMAIL, SHOW_ON_CARD)
VALUES (5, 'Shaykho', 'Resources Private Limited', 'shaykho.com', 'https://www.shaykho.com', NULL, NULL, 'Y');

COMMIT;

-- To change a company's card branding later:
--   UPDATE HR_COMPANY_BRANDING SET QR_URL = 'https://…', PHONE = '…' WHERE UNIT_ID = 5;
--   COMMIT;
