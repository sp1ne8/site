import { ZodError } from 'zod';
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || error.statusCode || 500;
  let message = error.message;
  if (error instanceof ZodError) { status = 400; message = error.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '); }
  else if (error.code === 'P2002') { status = 409; message = 'Запись с такими данными уже существует'; }
  else if (error.code === 'P2025') { status = 404; message = 'Запись не найдена'; }
  else if (error.code === 'P2003') { status = 400; message = 'Некорректная ссылка на запись'; }
  else if (error.code === 'P2034') { status = 409; message = 'Конфликт обновления. Повторите запрос'; }
  if (status >= 500) { console.error(JSON.stringify({event:'server_error', path:req.path, code:error.code, name:error.name})); message = 'Внутренняя ошибка сервера'; }
  res.status(status).json({success:false, message});
}
