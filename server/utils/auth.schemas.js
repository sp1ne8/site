import { z } from 'zod';

export const usernameSchema = z.string().trim().regex(/^[a-zA-Z0-9_]{3,32}$/, 'Логин: 3–32 латинские буквы, цифры или _.').transform((value) => value.toLowerCase());
export const emailSchema = z.string().trim().max(254).email('Укажите корректный email.').transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(10, 'Пароль должен содержать минимум 10 символов.').max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Пароль должен занимать не более 72 байт UTF-8.');
export const currentPasswordSchema = z.string().min(1).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Пароль слишком длинный.');
export const emptySchema = z.object({}).strict();
export const withMatchingPasswords = (schema) => schema.refine((value) => value.password === value.confirmPassword, { message: 'Пароли не совпадают.', path: ['confirmPassword'] });
