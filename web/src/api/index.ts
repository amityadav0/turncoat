import { config } from '../config';
import { httpApi } from './http';
import { mockApi } from './mock';

export const api = config.mock ? mockApi : httpApi;
export * from './types';
