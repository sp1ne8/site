// Explicit allow-list: never serialize Prisma's complete User record.
export const publicUserSelect = Object.freeze({
  id: true,
  username: true,
  email: true,
  role: true,
  balance: true,
  isBlocked: true,
  createdAt: true,
  updatedAt: true,
  jurisdiction: true,
  deletedAt: true,
  privacyRestricted: true,
});
