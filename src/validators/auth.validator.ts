import { z } from 'zod'

/** A selfie arrives as a base64 data URL. 7 MB of base64 is ~5 MB of image. */
const selfieImage = z
  .string()
  .max(7_000_000, 'The image is too large. Please try again.')
  .regex(/^data:image\/(png|jpe?g|webp);base64,/i, 'The captured image was not in a supported format.')

export const verifyNidSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  nid: z.string().trim().min(10).max(20),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD form'),
})

export const verifyFaceSchema = z.object({
  registrationToken: z.string().trim().min(16).max(128),
  selfieImage,
})

export const completeRegistrationSchema = z.object({
  registrationToken: z.string().trim().min(16).max(128),
  email: z.email('Enter a valid email address').max(200),
  phone: z.string().trim().min(6).max(30),
  password: z.string().min(8, 'Choose a password of at least 8 characters').max(200),
})

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  selfieImage: selfieImage.optional(),
})
