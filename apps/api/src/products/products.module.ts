import { Module } from '@nestjs/common';
import { DummyJsonClient } from './dummyjson.client';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [DummyJsonClient, ProductsService],
  exports: [ProductsService, DummyJsonClient],
})
export class ProductsModule {}
