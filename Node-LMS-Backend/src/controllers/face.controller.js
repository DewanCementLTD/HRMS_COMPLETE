import * as faceService from "../services/face.service.js";

export const faceRegister = async (req, res, next) => {
  try {
    const { card_no, frames, created_at } = res.locals.validated.body;
    if (frames.length < 10) {
      return res.status(400).json({ detail: "Minimum 10 frames required" });
    }
    const result = await faceService.registerFace(card_no, frames, created_at);
    res.json({
      body: {
        status: result.status,
        card_no: result.card_no,
        already_registered: result.already_registered || false,
        msg: result.msg || "",
      }
    });
  } catch (err) {
    next(err);
  }
};

export const faceVerify = async (req, res, next) => {
  try {
    const { card_no, frames } = res.locals.validated.body;
    if (frames.length < 5) {
      return res.status(400).json({ detail: "Minimum 5 frames required" });
    }
    const result = await faceService.verifyFace(card_no, frames);
    res.json({
      body: {
        is_match: result.is_match,
        confidence: result.confidence,
        message: result.message || "",
      }
    });
  } catch (err) {
    next(err);
  }
};

export const faceIdentify = async (req, res, next) => {
  try {
    const { frames } = res.locals.validated.body;
    if (frames.length < 5) {
      return res.status(400).json({ detail: "Minimum 5 frames required" });
    }
    const result = await faceService.identifyFace(frames);
    res.json({
      body: {
        identified: result.identified,
        card_no: result.card_no,
        emp_name: result.emp_name,
        confidence: result.confidence || 0.0,
        message: result.message || "",
      }
    });
  } catch (err) {
    next(err);
  }
};

export const faceStatus = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const result = await faceService.checkFaceStatus(card_no);
    res.json({
      body: {
        is_registered: result.is_registered,
        has_registered: result.is_registered,
        has_face: result.is_registered,
        card_no: card_no,
        registered_at: result.registered_at,
      }
    });
  } catch (err) {
    next(err);
  }
};

export const faceDelete = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const result = await faceService.deleteFace(card_no);
    res.json({
      body: {
        status: result.status,
        deleted: result.deleted,
        msg: result.msg,
        card_no: card_no,
      }
    });
  } catch (err) {
    next(err);
  }
};
