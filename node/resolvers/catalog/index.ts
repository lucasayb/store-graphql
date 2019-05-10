import { NotFoundError, UserInputError } from '@vtex/api'
import { all } from 'bluebird'
import { compose, equals, find, head, last, path, prop, split, test } from 'ramda'

import { toSearchTerm } from '../../utils/ioMessage'
import { resolvers as autocompleteResolvers } from './autocomplete'
import { resolvers as brandResolvers } from './brand'
import { resolvers as categoryResolvers } from './category'
import { resolvers as discountResolvers } from './discount'
import { resolvers as facetsResolvers } from './facets'
import { resolvers as itemMetadataResolvers } from './itemMetadata'
import { resolvers as itemMetadataUnitResolvers } from './itemMetadataUnit'
import { resolvers as offerResolvers } from './offer'
import { resolvers as productResolvers } from './product'
import { resolvers as recommendationResolvers } from './recommendation'
import { resolvers as searchResolvers } from './search'
import { resolvers as skuResolvers } from './sku'
import { Slugify } from './slug'

interface SearchArgs {
  query: string
  map: string
  category: string
  specificationFilters: [string]
  priceRange: string
  collection: string
  salesChannel: string
  orderBy: string
  from: number
  to: number
  hideUnavailableItems: boolean
}

/**
 * It will extract the slug from the HREF in the item
 * passed as parameter.
 *
 * That is needed once the API provide only the old link
 * (from CMS portal) to access the product page, nothing
 * more.
 *
 * HREF provided:
 * https://portal.vtexcommercestable.com.br/:slug/p
 *
 * @param item The item to extract the information
 */
export const extractSlug = (item: any) => {
  const href = split('/', item.href)
  return item.criteria ? `${href[3]}/${href[4]}` : href[3]
}

const lastSegment = compose<string, string[], string>(
  last,
  split('/')
)

function findInTree(tree: any, values: any, index = 0): any {
  for (const node of tree) {
    const slug = lastSegment(node.url)
    if (slug.toUpperCase() === values[index].toUpperCase()) {
      if (index === values.length - 1) {
        return node
      }
      return findInTree(node.children, values, index + 1)
    }
  }
  return {}
}
/** Get Category metadata for the search/productSearch query
 *
 */
const categoryMetaData = async (_: any, args: any, ctx: any) => {
  const { query } = args
  const category = findInTree(
    await queries.categories(_, { treeLevel: query.split('/').length }, ctx),
    query.split('/')
  )
  return {
    metaTagDescription: path(['MetaTagDescription'], category),
    titleTag: path(['Title'], category) || path(['Name'], category),
  }
}
/** Get brand metadata for the search/productSearch query
 *
 */
const brandMetaData = async (_: any, args: any, ctx: any) => {
  const brands = await queries.brands(_, { ...args }, ctx)
  const brand = find(
    compose(
      equals(args.query.split('/').pop(-1)),
      Slugify,
      prop('name') as any
    ),
    brands
  )
  return {
    metaTagDescription: path(['metaTagDescription'], brand as any),
    titleTag: path(['title'], brand as any) || path(['name'], brand as any),
  }
}

/**
 * Get metadata of category/brand APIs
 *
 * @param _
 * @param args
 * @param ctx
 */
const searchMetaData = async (_: any, args: any, ctx: any) => {
  const { map } = args
  const lastMap = map.split(',').pop(-1)
  const meta =
    lastMap === 'c'
      ? await categoryMetaData(_, args, ctx)
      : lastMap === 'b' && (await brandMetaData(_, args, ctx))
  return meta
}

/** TODO: This method should be removed in the next major.
 * @author Ana Luiza
 */
async function getProductBySlug(slug: string, catalog: any) {
  const products = await catalog.product(slug)
  if (products.length > 0) {
    return head(products)
  }
  throw new NotFoundError('No product was found with requested sku')
}

const translateToStoreDefaultLanguage = (clients: Context['clients']) => async (term: string): Promise<string> => {
  const { segment, messages } = clients
  const [{cultureInfo: to}, {cultureInfo: from}] = await all([
    segment.getSegmentByToken(null),
    segment.getSegment()
  ])
  return from && from !== to
    ? messages.translate(to, [toSearchTerm(term, from)]).then(head)
    : term
}

export const fieldResolvers = {
  ...autocompleteResolvers,
  ...brandResolvers,
  ...categoryResolvers,
  ...facetsResolvers,
  ...itemMetadataResolvers,
  ...itemMetadataUnitResolvers,
  ...offerResolvers,
  ...discountResolvers,
  ...productResolvers,
  ...recommendationResolvers,
  ...searchResolvers,
  ...skuResolvers,
}

export const queries = {
  autocomplete: async (_: any, args: any, ctx: Context) => {
    const {
      dataSources: { catalog },
      clients,
    } = ctx
    const translatedTerm = await translateToStoreDefaultLanguage(clients)(args.searchTerm)
    const { itemsReturned } = await catalog.autocomplete({
      maxRows: args.maxRows,
      searchTerm: translatedTerm,
    })
    return {
      cacheId: args.searchTerm,
      itemsReturned,
    }
  },

  facets: async (_: any, { facets, query, map }: any, ctx: Context) => {
    const {
      dataSources: { catalog },
    } = ctx
    const queryArgs = { query, map }

    let result

    if (facets) {
      result = await catalog.facets(facets)
    } else {
      result = await catalog.facets(`${query}?map=${map}`)
    }

    result.queryArgs = queryArgs

    return result
  },

  product: async (_: any, args: any, ctx: Context) => {
    const {
      dataSources: { catalog },
    } = ctx
    // TODO this is only for backwards compatibility. Should be removed in the next major.
    if (args.slug) {
      return getProductBySlug(args.slug, catalog)
    }

    const { field, value } = args.identifier
    let products = []

    switch (field) {
      case 'id':
        products = await catalog.productById(value)
        break
      case 'slug':
        products = await catalog.product(value)
        break
      case 'ean':
        products = await catalog.productByEan(value)
        break
      case 'reference':
        products = await catalog.productByReference(value)
        break
      case 'sku':
        products = await catalog.productBySku([value])
        break
    }

    if (products.length > 0) {
      return head(products)
    }

    throw new NotFoundError(`No product was found with requested ${field}`)
  },

  products: async (_: any, args: any, ctx: Context) => {
    const {
      dataSources: { catalog },
    } = ctx
    const queryTerm = args.query
    if (queryTerm == null || test(/[?&[\]=]/, queryTerm)) {
      throw new UserInputError(
        `The query term contains invalid characters. query=${queryTerm}`
      )
    }
    return catalog.products(args)
  },

  productSearch: async (_: any, args: SearchArgs, ctx: Context) => {
    const {
      dataSources: { catalog },
      clients,
    } = ctx
    const translate = translateToStoreDefaultLanguage(clients)
    const translatedArgs = {
      ...args,
      query: await translate(args.query),
    }
    const products = await queries.products(_, translatedArgs, ctx)
    const recordsFiltered = await catalog.productsQuantity(translatedArgs)
    const { titleTag, metaTagDescription }: any = await searchMetaData(
      _,
      translatedArgs,
      ctx
    )
    return {
      titleTag,
      metaTagDescription,
      products,
      recordsFiltered,
    }
  },

  brand: async (_: any, args: any, { dataSources: { catalog } }: Context) => {
    const brands = await catalog.brands()
    const brand = find(
      compose(
        equals(args.id),
        prop('id') as any
      ),
      brands
    )
    if (!brand) {
      throw new NotFoundError(`Brand not found`)
    }
    return brand
  },

  brands: async (_: any, __: any, { dataSources: { catalog } }: Context) =>
    catalog.brands(),

  category: async (
    _: any,
    { id }: any,
    { dataSources: { catalog } }: Context
  ) => catalog.category(id),

  categories: async (
    _: any,
    { treeLevel }: any,
    { dataSources: { catalog } }: Context
  ) => catalog.categories(treeLevel),

  /** TODO: This method should be removed in the next major.
   * @author Bruno Dias
   */
  search: async (_: any, args: any, ctx: Context) => {
    const { map, query } = args

    if (query == null || map == null) {
      throw new UserInputError('Search query/map cannot be null')
    }

    const { titleTag, metaTagDescription }: any = await searchMetaData(
      _,
      args,
      ctx
    )

    return {
      metaTagDescription,
      queryArgs: args,
      titleTag,
    }
  },

  searchContextFromParams: async (
    _: any,
    args: any,
    { dataSources: { catalog } }: Context
  ) => {
    const response = {
      brand: null,
      category: null,
      contextKey: 'search',
    }

    if (args.brand) {
      const brands = await catalog.brands()
      const found = brands.find(
        (brand: any) => brand.isActive && Slugify(brand.name) === args.brand
      )
      response.brand = found && found.id
    }

    if (args.department) {
      const departments = await catalog.categories(2)
      let found: Category

      found = departments.find((department: any) =>
        department.url.endsWith(`/${args.department.toLowerCase()}`)
      )
      if (args.category && found) {
        found = found.children.find(category =>
          category.url.endsWith(`/${args.category.toLowerCase()}`)
        ) as any
      }

      if (args.subcategory && found) {
        found = found.children.find(subcategory =>
          subcategory.url.endsWith(`/${args.subcategory.toLowerCase()}`)
        ) as any
      }

      response.category = found && (found.id as any)
    }

    return response
  },
}

interface Category {
  id: string
  name: string
  url: string
  children: Category[]
}
