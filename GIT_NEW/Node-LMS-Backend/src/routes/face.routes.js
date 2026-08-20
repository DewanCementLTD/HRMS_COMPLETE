import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import * as schemas from "../models/face.schema.js";
import * as controllers from "../controllers/face.controller.js";

const router = Router();

router.post("/register", validate(schemas.faceRegisterSchema), controllers.faceRegister);
router.post("/verify", validate(schemas.faceVerifySchema), controllers.faceVerify);
router.post("/identify", validate(schemas.faceIdentifySchema), controllers.faceIdentify);
router.get("/status/:card_no", validate(schemas.faceStatusSchema), controllers.faceStatus);
router.delete("/delete/:card_no", validate(schemas.faceDeleteSchema), controllers.faceDelete);

export default router;
