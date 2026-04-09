export type ActivityType = 'morning' | 'class' | 'lunch' | 'break' | 'afterschool';

export interface Teacher {
  id: string;
  name: string;
  email: string;
  className?: string;
  createdAt: any;
}

export interface Schedule {
  id: string;
  teacherId: string;
  date: string; // YYYY-MM-DD
  title: string;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface ScheduleItem {
  id: string;
  order: number;
  activityName: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  activityType: ActivityType;
  voiceText?: string;
  useVoice: boolean;
  color?: string;
}

export interface DisplaySettings {
  showCountdown: boolean;
  showNextActivity: boolean;
  fullscreenMode: boolean;
  theme: string;
  voiceRate: number;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
