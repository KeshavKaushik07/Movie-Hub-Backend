import ApiError from './ApiError.js';

// Password rule: at least 6 characters (allows existing test credentials + strong passwords)
export const assertStrongPassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 6 || pw.length > 72) {
    throw ApiError.badRequest('Password must be 6-72 characters');
  }
};
