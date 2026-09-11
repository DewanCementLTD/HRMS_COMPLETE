import {
  authenticateUser,
  getProfile,
  lookupByPhone,
  changePassword,
  saveEmergencyContact as saveEmergencyContactService,
} from "../services/auth.service.js";
import { forceUpdateBlock } from "../services/appVersion.service.js";
import {
  empcodeForCard,
  getEmployeePhotoAbs,
} from "../services/documents.service.js";

import { logger } from "../utils/logger.js";
export const login = async (req, res, next) => {
  try {
    const { username, password, app_version, app_build, platform, device_id } =
      res.locals.validated.body;

    // Bug 5.3: Force-update guard — blocks outdated mobile apps (HTTP 426).
    // Web omits app_version so web logins are never affected.
    const blk = await forceUpdateBlock(
      app_version,
      app_build,
      platform || "ANDROID",
    );
    if (blk) {
      return res.status(426).json({
        detail: {
          code: "FORCE_UPDATE",
          message: blk.message,
          update_url: blk.update_url,
        },
      });
    }

    const result = await authenticateUser(username, password, device_id);
    if (!result) return res.status(401).json({ detail: "Invalid credentials" }); // exact FastAPI wording — the app shows it verbatim
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const profile = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const data = await getProfile(card_no);
    if (!data) return res.status(404).json({ detail: "User not found" }); // exact FastAPI wording
    res.json(data);
  } catch (err) {
    next(err);
  }
};

// GET /auth/profile-picture/:card_no — the employee's photo, as bytes.
//
// The same file HRMS web shows (HR_EMP_MASTER.PATH); this is the fallback the
// mobile app uses when the profile payload carries no photo URL, so it lives
// under /auth/* and takes the same auth as the rest of the employee endpoints.
export const profilePicture = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const empcode = await empcodeForCard(card_no);
    const photoPath = empcode ? await getEmployeePhotoAbs(empcode) : null;
    if (!photoPath) {
      return res.status(404).json({ detail: "No photo" });
    }
    res.set("Cache-Control", "no-cache");
    res.sendFile(photoPath);
  } catch (err) {
    next(err);
  }
};

export const lookup = async (req, res, next) => {
  try {
    const { phone } = res.locals.validated.params;
    const data = await lookupByPhone(phone);
    if (!data) return res.status(404).json({ detail: "Employee not found" }); // exact FastAPI wording
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const updatePassword = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { old_password, new_password } = res.locals.validated.body;
    // NOTE: never log the passwords themselves — this used to interpolate both
    // into the message, writing them in plaintext to logs/auth.log.
    logger.info(`Password change requested for card_no=${card_no}`);
    const result = await changePassword(card_no, old_password, new_password);
    if (!result.success)
      return res.status(400).json({ detail: "Invalid old password" }); // exact FastAPI wording
    res.json({ status: "SUCCESS", message: "Password updated successfully." });
  } catch (err) {
    next(err);
  }
};

// POST /auth/emergency-contact/:card_no          (web)
// POST /auth/profile/emergency-contact/:card_no  (mobile app)
//
// One handler for both: the same contact, saved to the same row. The app keeps
// its own copy on the device only until this returns — the stored value is what
// survives a reinstall or a new phone, so the response says plainly whether the
// save landed.
export const saveEmergencyContact = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const body = res.locals.validated.body;
    const relation = body.relation ?? body.relationship ?? "";
    const phone = body.phone || body.phone_number || "";

    if (!String(phone).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "A contact phone number is required." });
    }

    const result = await saveEmergencyContactService(
      card_no,
      body.name,
      relation,
      phone,
    );
    if (result.status === "error") {
      return res.status(500).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      status: "SUCCESS",
      message: result.message,
      emergency_contact: {
        name: body.name,
        relation,
        relationship: relation,
        phone,
        phone_number: phone,
      },
    });
  } catch (err) {
    next(err);
  }
};
