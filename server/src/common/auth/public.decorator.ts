import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './authenticated-user';

/** Marks a route as not requiring a valid access token (auth + health endpoints). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
