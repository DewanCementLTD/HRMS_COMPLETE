import { Router } from 'express';

import { validate } from '../middlewares/validate.middleware.js';
import { requireSuperAdmin } from '../middlewares/superAdmin.middleware.js';
import * as schemas from '../models/superAdmin.schema.js';
import * as controller from '../controllers/superAdmin.controller.js';

const router = Router();

// Sign-in is the only open route; everything else needs the Bearer token it
// returns, and the USRID inside that token must still be in SUPER_ADMIN_USRIDS.
router.post('/login', validate(schemas.adminLoginSchema), controller.login);

router.get('/me', requireSuperAdmin, controller.me);
router.get('/users', requireSuperAdmin, controller.listUsers);
router.get('/scope', requireSuperAdmin, controller.scopeOptions);

router.post('/users', requireSuperAdmin, validate(schemas.createUserSchema), controller.createUser);
router.put('/users/:usrid/companies', requireSuperAdmin, validate(schemas.setCompaniesSchema), controller.setCompanies);
router.put('/users/:usrid/branches', requireSuperAdmin, validate(schemas.setBranchesSchema), controller.setBranches);
router.put('/users/:usrid/status', requireSuperAdmin, validate(schemas.setStatusSchema), controller.setStatus);
router.put('/users/:usrid/password', requireSuperAdmin, validate(schemas.setPasswordSchema), controller.setPassword);

export default router;
