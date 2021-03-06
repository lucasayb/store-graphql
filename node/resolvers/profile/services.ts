import { parse } from 'cookie'
import { compose, mapObjIndexed, pick, split, values } from 'ramda'

import { generateRandomName } from '../../utils'
import { makeRequest } from '../auth'
import paths from '../paths'

export function getProfile(context: Context, customFields?: string) {
  const {
    clients: { profile },
    vtex: { currentProfile },
  } = context

  const extraFields = customFields
    ? `${customFields},profilePicture,id`
    : `profilePicture,id`

  return profile
    .getProfileInfo(currentProfile, extraFields)
    .then(profileData => {
      if (profileData) {
        return {
          ...profileData,
          customFields,
        }
      }

      return { email: currentProfile.email }
    })
}

export function getPasswordLastUpdate(context: Context) {
  const {
    request: {
      headers: { cookie },
    },
    vtex: { account },
  } = context
  const url = paths.getUser(account)
  const parsedCookies = parse(cookie)
  const userCookie: string = parsedCookies[`VtexIdclientAutCookie_${account}`]

  if (!userCookie) return null

  return makeRequest(context.vtex, url, 'GET', undefined, userCookie).then(
    (response: any) => {
      return response.data.passwordLastUpdate
    }
  )
}

export function getAddresses(context: Context) {
  const {
    clients: { profile },
    vtex: { currentProfile },
  } = context

  return profile.getUserAddresses(currentProfile).then(mapAddressesObjToList)
}

export async function getPayments(context: Context) {
  const {
    clients: { profile },
    vtex: { currentProfile },
  } = context

  const paymentsRawData = await profile.getUserPayments(currentProfile)

  if (!paymentsRawData) {
    return null
  }

  const addresses = await getAddresses(context)
  const availableAccounts = JSON.parse(paymentsRawData.paymentData)
    .availableAccounts

  return availableAccounts.map((account: any) => {
    const { bin, availableAddresses, accountId, ...cleanAccount } = account
    const accountAddress = addresses.find(
      (addr: UserAddress) => addr.addressName === availableAddresses[0]
    )
    return { ...cleanAccount, id: accountId, address: accountAddress }
  })
}

export async function updateProfile(
  context: Context,
  profile: Profile,
  customFields: CustomField[] | undefined
) {
  const {
    clients,
    vtex: { currentProfile },
  } = context

  const extraFields = customFields && mapCustomFieldsToObjNStr(customFields)

  const newData = {
    ...profile,
    // Read the comments in Profile in fieldResolvers.ts files
    // to understand the following transformations
    businessDocument: profile.corporateDocument,
    isPJ: profile.isCorporate ? 'True' : 'False',
    fancyName: profile.tradeName,
    ...(extraFields && extraFields.customFieldsObj),
  }

  return clients.profile
    .updateProfileInfo(
      currentProfile,
      newData,
      extraFields && extraFields.customFieldsStr
    )
    .then(() => getProfile(context, extraFields && extraFields.customFieldsStr))
}

export function updateProfilePicture(mutationsName: string, context: Context) {
  console.warn(
    `The ${mutationsName} mutation is deprecated and no longer supported.`
  )
  return getProfile(context)
}

// CRUD Address

export function createAddress(context: Context, address: Address) {
  const {
    clients: { profile },
    vtex: { currentProfile },
  } = context

  const addressesData = {} as any
  const addressName = generateRandomName()
  const { geoCoordinates, ...addr } = address

  addressesData[addressName] = JSON.stringify({
    ...addr,
    geoCoordinate: geoCoordinates,
    addressName,
    userId: currentProfile.userId,
  })

  return profile
    .updateAddress(currentProfile, addressesData)
    .then(() => getProfile(context))
}

export function deleteAddress(context: Context, addressName: string) {
  const {
    clients: { profile },
    vtex: { currentProfile },
  } = context

  return profile
    .deleteAddress(currentProfile, addressName)
    .then(() => getProfile(context))
}

export function updateAddress(
  context: Context,
  { id, fields: { geoCoordinates, ...addressFields } }: UpdateAddressArgs
) {
  const {
    clients: { profile },
    vtex: { currentProfile },
  } = context

  const addressesData = {} as any
  addressesData[id] = JSON.stringify({
    ...addressFields,
    geoCoordinate: geoCoordinates,
    userId: currentProfile.userId,
  })

  return profile
    .updateAddress(currentProfile, addressesData)
    .then(() => getProfile(context))
}

export function pickCustomFieldsFromData(customFields: string, data: any) {
  return (
    customFields &&
    compose(
      values,
      mapObjIndexed((value, key) => ({ key, value })),
      pick(split(',', customFields)) as any
    )(data)
  )
}

// Aux

function mapCustomFieldsToObjNStr(customFields: CustomField[] = []) {
  let customFieldsStr = ''
  const customFieldsObj = customFields.reduce((acc: any, currentValue, i) => {
    customFieldsStr +=
      i < customFields.length - 1 ? `${currentValue.key},` : currentValue.key

    acc[currentValue.key] = currentValue.value

    return acc
  }, {})

  return {
    customFieldsObj,
    customFieldsStr,
  }
}

function mapAddressesObjToList(addressesObj: any) {
  return Object.values<string>(addressesObj).map(stringifiedObj =>
    JSON.parse(stringifiedObj)
  )
}

interface UpdateAddressArgs {
  id: string
  fields: Address
}

interface CustomField {
  key: string
  value: string
}
