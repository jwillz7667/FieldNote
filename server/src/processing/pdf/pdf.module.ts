import { Module } from '@nestjs/common';
import { PdfRendererService } from './pdf-renderer.service';

@Module({
  providers: [PdfRendererService],
  exports: [PdfRendererService],
})
export class PdfModule {}
