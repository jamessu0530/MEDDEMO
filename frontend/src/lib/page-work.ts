import type { Product } from "@/api/products"
import { type Work } from "@/lib/background-work"
import {
  productCatalogWork,
  type ProductCatalogQuery,
  type ProductCatalogResult,
} from "@/lib/product-catalog-work"
import { legPathsWork, type RouteGeometry } from "@/lib/route-geometry-work"
import { drawPlanWork, type DrawPlan } from "@/lib/route-draw"
import {
  reportMatrixWork,
  type MatrixWorkSource,
  type MatrixWorkQuery,
  type MatrixWorkResult,
} from "@/lib/report-matrix-work"

export type PageWorkInput =
  | { kind: "products"; source: Product[]; query: ProductCatalogQuery }
  | { kind: "route"; source: RouteGeometry }
  | { kind: "matrix"; source: MatrixWorkSource; query: MatrixWorkQuery }
export type PageWorkResult =
  | { kind: "products"; value: ProductCatalogResult }
  | { kind: "route"; value: DrawPlan }
  | { kind: "matrix"; value: MatrixWorkResult }

export function* pageWork(input: PageWorkInput): Work<PageWorkResult> {
  switch (input.kind) {
    case "products":
      return {
        kind: input.kind,
        value: yield* productCatalogWork(input.source, input.query),
      }
    case "route":
      return {
        kind: input.kind,
        value: yield* drawPlanWork(yield* legPathsWork(input.source)),
      }
    case "matrix":
      return {
        kind: input.kind,
        value: yield* reportMatrixWork(input.source, input.query),
      }
  }
}
