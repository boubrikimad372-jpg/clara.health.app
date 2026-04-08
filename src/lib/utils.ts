import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Language = 'EN' | 'AR' | 'HI' | 'UR';

export interface UserData {
  name?: string;
  agreedToTerms: boolean;
  intakeText: string;
  age?: string;
  seenDoctorBefore: boolean;
  doctorFindings?: string;
}

export type Screen = 'DISCLAIMER' | 'WELCOME' | 'INTAKE' | 'DEMOGRAPHICS' | 'MEDICAL_HISTORY' | 'OUTPUT_LANGUAGE' | 'ANALYSIS' | 'RESULTS';
