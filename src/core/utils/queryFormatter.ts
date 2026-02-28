export type FilterQuery = string | string[] | undefined

export const parseQueryArray = (val: FilterQuery) => {
  if (!val) return undefined
  return Array.isArray(val) ? val : [val]
}

export const parseQuerySizeToArray = (val: FilterQuery) => {
  if (!val) return undefined

  const sizeArr = Array.isArray(val) ? val : [val]

  return sizeArr.map(size => {
    const width = Number(size.split("x")[0])
    const height = Number(size.split("x")[1])
    return {
      width: isNaN(width) ? 0 : width,
      height: isNaN(height) ? 0 : height
    }
  })
}
