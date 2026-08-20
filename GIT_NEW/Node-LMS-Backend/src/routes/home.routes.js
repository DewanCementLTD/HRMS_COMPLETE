import { logger } from '../utils/logger.js';
const home = (req, res) => {
    logger.info("Home Routes initialized");
    res.send("Welcome To Home");
};

export default home;