import { z } from 'zod';

// Zod schemas shared by forms (and the API later). Messages are user-facing.
const req = (label: string) => z.string().trim().min(1, `${label} is required`);
const phone = z.string().trim().regex(/^[+\d][\d\s()-]{6,}$/, 'Enter a valid phone number');

export const loginSchema = z.object({ userId: req('User ID').max(20), password: req('Password') });

export const changePasswordSchema = (minLen = 10) =>
  z.object({
    current: req('Current password'),
    next: z.string().min(minLen, `At least ${minLen} characters`).regex(/[A-Z]/, 'Include an uppercase letter').regex(/[a-z]/, 'Include a lowercase letter').regex(/\d/, 'Include a digit'),
    confirm: z.string(),
  }).refine((v) => v.next === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

export const clientInternalSchema = z.object({
  clientCode: req('Company code').max(14).regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, digits and dashes'),
  clientName: req('Company name').max(150),
  billingName: req('Billing name').max(150),
  branchCode: req('Branch'),
  address1: req('Registered address').max(150),
  address2: z.string().max(150).optional(),
  firstName: req('Contact first name').max(100),
  lastName: req('Contact last name').max(100),
  phone,
  email: z.string().email('Enter a valid email'),
  aeAssigned: req('AE assigned'),
});
export type ClientInternalForm = z.infer<typeof clientInternalSchema>;

export const clientPortalSchema = z.object({
  clientName: req('Company name').max(150),
  branchCode: req('Branch'),
  address1: req('Business address').max(150),
  firstName: req('First name').max(100),
  lastName: req('Last name').max(100),
  phone,
  email: z.string().email('Enter a valid email'),
  password: z.string().min(10, 'At least 10 characters').regex(/[A-Z]/, 'Include an uppercase letter').regex(/[a-z]/, 'Include a lowercase letter').regex(/\d/, 'Include a digit'),
  confirm: z.string(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required under the Data Privacy Act' }) }),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" });
export type ClientPortalForm = z.infer<typeof clientPortalSchema>;

export const ewaSchema = z.object({
  clientCode: req('Client'),
  contractNo: req('Contract'),
  branchCode: req('Pickup branch'),
  driverName: req('Driver name'),
  driverLicenseNo: req('Driver licence no.'),
  truckPlateNo: req('Truck plate no.'),
  trucker: req('Trucker'),
  units: z.array(z.object({ equipmentType: req('Equipment type'), qty: z.coerce.number().int().min(1, 'Min 1') })).min(1, 'Add at least one unit'),
});
export type EwaForm = z.infer<typeof ewaSchema>;

export const rescueRequestSchema = z.object({
  chassisNo: req('Chassis / unit'),
  locationText: req('Location'),
  incident: req('Incident description'),
  sceneContactName: req('Scene contact name'),
  sceneContactPhone: phone,
  urgent: z.boolean(),
  loadStatus: z.enum(['Loaded', 'Empty']).optional(),
  photos: z.array(z.string()).optional(), // file names of supporting photos (DBL-RES-001)
});
export type RescueRequestForm = z.infer<typeof rescueRequestSchema>;
