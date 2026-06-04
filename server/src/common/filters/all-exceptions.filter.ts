import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/** RFC 7807-style problem document returned for every error. */
export interface ProblemResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
  timestamp: string;
  path: string;
}

/**
 * Single place that turns any thrown error into a consistent problem JSON.
 * Logs once here (handoff: "log once, at the boundary that handles the error")
 * and never leaks stack traces or Prisma internals to clients in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, error, message } = this.normalize(exception);

    const body: ProblemResponse = {
      statusCode: status,
      error,
      message,
      requestId: request.id,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        { err: exception, requestId: request.id, path: request.url, status },
        `Unhandled ${status} on ${request.method} ${request.url}`,
      );
    } else {
      this.logger.debug(`${status} on ${request.method} ${request.url}: ${JSON.stringify(message)}`);
    }

    response.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { status, error: exception.name, message: res };
      }
      const obj = res as { message?: string | string[]; error?: string };
      return {
        status,
        error: obj.error ?? exception.name,
        message: obj.message ?? exception.message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: 'Invalid query parameters.' };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred.',
    };
  }

  private mapPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    error: string;
    message: string;
  } {
    switch (e.code) {
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'Resource not found.' };
      case 'P2002':
        return { status: HttpStatus.CONFLICT, error: 'Conflict', message: 'Resource already exists.' };
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: 'Related resource missing.' };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'A database error occurred.',
        };
    }
  }
}
