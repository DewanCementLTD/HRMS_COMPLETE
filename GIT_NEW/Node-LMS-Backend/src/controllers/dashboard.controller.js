import { getDashboardData } from '../services/dashboard.service.js';

export const getDashboard = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const data = await getDashboardData(card_no);
    if (!data)
      return res.status(404).json({ detail: 'User not found' }); // exact FastAPI wording
    res.json(data);
  } catch (err) {
    next(err);
  }
};
