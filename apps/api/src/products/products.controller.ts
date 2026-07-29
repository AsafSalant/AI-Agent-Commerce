import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { Product, ProductCategory, ProductSearchResult } from '@shopping-copilot/shared';
import { SearchProductsDto } from './dto/search-products.dto';
import { ProductsService } from './products.service';

@Controller('api/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  search(@Query() query: SearchProductsDto): Promise<ProductSearchResult> {
    return this.products.search(query);
  }

  @Get('categories')
  categories(): Promise<ProductCategory[]> {
    return this.products.getCategories();
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number): Promise<Product> {
    return this.products.getProduct(id);
  }
}
