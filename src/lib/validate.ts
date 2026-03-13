import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Factory that returns an Express middleware validating req.body against a Zod schema.
 * Returns 400 with field-level error details on failure.
 * Compatible with both Zod v3 (.errors) and v4 (.issues).
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const err = result.error as any;
      const issues: any[] = err.issues ?? err.errors ?? [];
      const errors = issues.map((e: any) => ({
        field:   Array.isArray(e.path) ? e.path.join('.') : '',
        message: e.message ?? 'Valor inválido.',
      }));
      return res.status(400).json({ error: 'Dados inválidos.', details: errors });
    }
    req.body = result.data;
    next();
  };
}
