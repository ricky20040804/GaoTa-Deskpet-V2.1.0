export const petCatalog = [
  {
    animalType: 'dog',
    breed: 'beagle',
    label: 'Beagle',
    templatePath: '/pet-templates/dog/beagle/template.json',
    motionPath: '/pet-templates/dog/shared_motion.json',
    partsBasePath: '/pet-templates/dog/beagle/parts',
    overviewImagePath: '/pet-templates/dog/beagle/Overview.png',
  },
  {
    animalType: 'dog',
    breed: 'golden',
    label: 'Golden',
    templatePath: '/pet-templates/dog/golden/template.json',
    motionPath: '/pet-templates/dog/shared_motion.json',
    partsBasePath: '/pet-templates/dog/golden/parts',
    overviewImagePath: '/pet-templates/dog/golden/Overview.png',
  },
  {
    animalType: 'dog',
    breed: 'shiba',
    label: 'Shiba',
    templatePath: '/pet-templates/dog/shiba/template.json',
    motionPath: '/pet-templates/dog/shared_motion.json',
    partsBasePath: '/pet-templates/dog/shiba/parts',
    overviewImagePath: '/pet-templates/dog/shiba/Overview.png',
  },
  {
    animalType: 'cat',
    breed: 'ragdoll',
    label: 'Ragdoll',
    templatePath: '/pet-templates/cat/ragdoll/template.json',
    motionPath: '/pet-templates/cat/shared_motion.json',
    partsBasePath: '/pet-templates/cat/ragdoll/parts',
    overviewImagePath: '/pet-templates/cat/ragdoll/overview.png',
  },
];

export const animalOptions = [
  { id: 'dog', label: 'dog' },
  { id: 'cat', label: 'cat' },
  { id: 'bird', label: 'bird' },
];

export const getPetTemplatesByAnimal = (animalType) =>
  petCatalog.filter((template) => template.animalType === animalType);
