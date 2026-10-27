import { getDirectConnection } from "../config/database.js";
import { verifyEmployeeToken, sessionOwnsCard } from "../services/employeeSession.service.js";

import { logger } from '../utils/logger.js';

// The signed session token issued at login (see employeeSession.service.js).
// Read from the Authorization header, or from ?session_token= for URLs the
// browser loads itself (<img src>, download links) and so cannot add a header.
const sessionTokenFrom = (req) => {
  const header = String(req.headers.authorization ?? '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(req.query?.session_token ?? '').trim();
};

// Escape hatch only: HR_ADMIN_REQUIRE_SESSION=false turns the token check back
// into a logged warning, for an older client that cannot send it yet.
const requireSession = () => String(process.env.HR_ADMIN_REQUIRE_SESSION ?? 'true').trim().toLowerCase() !== 'false';

export const requireHrAdmin = async (req, res, next) => {
  let connection;

  try {
    connection = await getDirectConnection();

    const admin_card_no = req.query?.admin_card_no || req.body?.admin_card_no || res.locals?.validated?.query?.admin_card_no;

    // FastAPI declares admin_card_no as `Query(...)`, so a request without it is
    // rejected with 422 before require_hr_admin ever runs. Match that instead of
    // carrying `undefined` into the lookup below (which crashed on .startsWith).
    if (!admin_card_no) {
      return res.status(422).json({
        detail: [{ type: 'missing', loc: ['query', 'admin_card_no'], msg: 'Field required', input: null }],
      });
    }

    // The card number alone proves nothing (it is printed on ID cards and sits
    // in URLs). The caller must hold a login token for that same card.
    const session = verifyEmployeeToken(sessionTokenFrom(req));
    if (!session) {
      if (requireSession()) {
        return res.status(401).json({
          detail: { code: 'SESSION_REQUIRED', message: 'Sign in again to continue' },
        });
      }
      logger.warn(`[HR_ADMIN] no session token for admin_card_no=${admin_card_no} on ${req.method} ${req.originalUrl.split('?')[0]}`);
    } else if (!sessionOwnsCard(session, admin_card_no)) {
      logger.warn(`[HR_ADMIN] card mismatch: token=${session.card_no} sent admin_card_no=${admin_card_no}`);
      return res.status(403).json({ detail: 'HR admin access required' });
    }

    let mobile = "";
    let empcode = "";

    // -------------------------------
    // STEP 1: Lookup employee/mobile
    // -------------------------------
    try {
      const lookup = await connection.execute(
        `
        SELECT
            h."MOBILE#" AS MOBILE,
            h.EMPCODE
        FROM HR_EMP_MASTER h
        LEFT JOIN EMPLOYEE e
               ON e.EMPCODE = h.EMPCODE
        WHERE TO_CHAR(e.CARD_NO) = :cn1
           OR TO_CHAR(h."ATDTCARD#") = :cn2
           OR h.EMPCODE = :cn3
        `,
        {
          cn1: admin_card_no,
          cn2: admin_card_no,
          cn3: admin_card_no,
        },
        { outFormat: 4002 }
      );

      if (lookup.rows.length > 0) {
        mobile = String(lookup.rows[0].MOBILE ?? "").trim();
        empcode = String(lookup.rows[0].EMPCODE ?? "").trim();
      } else {
        mobile = String(admin_card_no);
      }
    } catch (err) {
      logger.error({ err }, "[HR_ADMIN] employee lookup failed");
      mobile = admin_card_no;
    }

    // --------------------------------
    // STEP 2: Check by employee code
    // --------------------------------

    if (empcode) {
      const result = await connection.execute(
        `
        SELECT COUNT(*) CNT
        FROM SEC_USERNAME
        WHERE ECODE = :ec
          AND STATS='E'
        `,
        {
          ec: empcode,
        },
        { outFormat: 4002 }
      );

      if (result.rows[0].CNT > 0) {
        return next();
      }
    }

    // --------------------------------
    // STEP 3: Check by mobile number
    // --------------------------------

    const m1 = mobile;
    const m2 = mobile.startsWith("0") ? mobile : "0" + mobile;
    const m3 = mobile.startsWith("0") ? mobile.substring(1) : mobile;
    logger.debug({ m1, m2, m3 }, "[HR_ADMIN] Checking mobile numbers");
    const result = await connection.execute(
      `
      SELECT COUNT(*) CNT
      FROM SEC_USERNAME
      WHERE TO_CHAR(MOBILE) IN (:m1,:m2,:m3)
        AND STATS='E'
      `,
      {
        m1,
        m2,
        m3,
      },
      { outFormat: 4002 }
    );

    if (result.rows[0].CNT > 0) {
      return next();
    }

    return res.status(403).json({
      detail: "HR admin access required",
    });
  } catch (err) {
    next(err);
  } finally {
    await connection?.close();
  }
};