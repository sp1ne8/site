import { z } from 'zod';
export const validate = (schemas = {}) => (req, res, next) => {
  try {
    req.validated = {};
    for (const part of ['body', 'query', 'params']) {
      req.validated[part] = (schemas[part] || z.object({}).strict()).parse(req[part] ?? {});
    }
    next();
  } catch (error) { next(error); }
};
