import User from '../models/User.js';
import { logger } from '../utils/logger.js';

const seedSuperAdmin = async () => {
  const { SUPERADMIN_NAME, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD } = process.env;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    logger.warn('SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set - skipping superadmin seed');
    return;
  }

  const exists = await User.findOne({ role: 'superadmin' });
  if (exists) {
    logger.info('Superadmin already exists — skipping seed');
    return;
  }

  try {
    await User.create({
      name: SUPERADMIN_NAME || 'Super Admin',
      email: SUPERADMIN_EMAIL,
      password: SUPERADMIN_PASSWORD,
      role: 'superadmin',
      isActive: true,
    });
    logger.success(`Superadmin created: ${SUPERADMIN_EMAIL}`);
  } catch (err) {
    if (err.code === 11000) {
      await User.updateOne({ email: SUPERADMIN_EMAIL.toLowerCase().trim() }, { role: 'superadmin', isActive: true });
      logger.success(`Promoted existing ${SUPERADMIN_EMAIL} to superadmin`);
    } else {
      throw err;
    }
  }
};

export default seedSuperAdmin;
