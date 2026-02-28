export const validationsStrings = {
  product: {
    idRequired: "Product id is required",
    nameRequired: "Product name is required",
    applicationRequired: "Type must be either 'Lantai' or 'Dinding'",
    designRequired: "Design is required",
    sizeWidthPositive: "Width must be a positive number",
    sizeHeightPositive: "Height must be a positive number",
    colorRequired: "Color is required",
    finishingRequired: "Finishing is required",
    textureRequired: "Texture is required",
    brandRequired: "Brand is required",
    priceNonNegative: "Price must not be negative",
    tilesPerBoxNonNegative: "Tiles Per Box must not be negative",
    discountNonNegative: "Discount must not be negative",
    discountMustBeBetween0And100: "Discount must be between 0 and 100",
    imageFileRequired: "Image file is required",
    invalidImageFile: "Only image files are allowed (.jpg, .jpeg, .png, .webp)",
    promptRequired: "Prompt is required"
  },
  user: {
    firstNameRequired: "First name is required",
    lastNameRequired: "Last name is required",
    usernameTooShort: "Username must be at least 3 characters",
    usernameTooLong: "Username must be less than 20 characters",
    passwordTooShort: "Password must be at least 6 characters",
    roleInvalid: "Role must be one of: admin, user"
  }
};
