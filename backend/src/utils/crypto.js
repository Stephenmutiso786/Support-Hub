const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || '').split(':');
  if (!salt || !expectedHash) {
    return false;
  }

  const passwordHashBuffer = crypto.scryptSync(password, salt, 64);
  const expectedHashBuffer = Buffer.from(expectedHash, 'hex');

  if (passwordHashBuffer.length !== expectedHashBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(passwordHashBuffer, expectedHashBuffer);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  sha256,
};
