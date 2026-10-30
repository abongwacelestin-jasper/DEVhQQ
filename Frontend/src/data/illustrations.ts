/**
 * Every rendered illustration in the product, in one place. Swap a URL here (e.g. for a
 * self-hosted copy under /public/illustrations/…) and every screen using it updates.
 */
export const illustrations = {
  welcome: {
    src: '/0254787c-b2b9-4e26-8902-c126b0eacb3f.jpg',
    alt: 'A laptop showing a project dashboard on a tidy desk',
    ratio: '3/2',
  },
  security: {
    src: '/3428011a-a255-4137-a037-a0b4fa18e7ad.jpg',
    alt: 'A shield with a padlock beside a hardware security key',
    ratio: '3/2',
  },
  empty: {
    src: '/8f707055-c9a2-401e-8aef-5c7ce42b2a58.jpg',
    alt: 'An empty inbox tray with a checkmark',
    ratio: '4/3',
  },
  idle: {
    src: '/a0967989-1a96-4b96-b329-0720ba2c705e.jpg',
    alt: 'A closed laptop with a padlock above it',
    ratio: '3/2',
  },
  incident: {
    src: '/5b0baba6-f6b4-4bb2-acf2-221584852f1c.jpg',
    alt: 'A server with a red alert light next to a pager and fire extinguisher',
    ratio: '3/2',
  },
  signIn: {
    src: '/8b0d9bb7-a42b-4164-a73e-c6789a6b4c9c.jpg',
    alt: 'A laptop sign-in screen with a shield, phone code and security key',
    ratio: '4/3',
  },
  nda: {
    src: '/3655cdd2-bed4-4e59-b1f9-5d915bc64f48.jpg',
    alt: 'A sealed confidentiality agreement with a pen',
    ratio: '4/3',
  },
  profile: {
    src: '/93f95105-f523-4cce-842a-e212dbc48317.jpg',
    alt: 'A profile ID card with a verified badge',
    ratio: '4/3',
  },
  lockedGate: {
    src: '/d71953e5-1441-41ba-8088-b64e5a38c5cf.jpg',
    alt: 'A closed gate with a padlock and a keycard',
    ratio: '4/3',
  },
  docs: {
    src: '/252ece5c-1b94-493a-af9d-2bab8da18be1.jpg',
    alt: 'A stack of documents and a tabbed binder',
    ratio: '4/3',
  },
  chat: {
    src: '/1d982b06-5712-407b-b4db-0ff11161899f.jpg',
    alt: 'Stacked chat bubbles with a send arrow',
    ratio: '4/3',
  },
  code: {
    src: '/b9ed45ce-aa6f-4f60-83d6-e776622d594f.jpg',
    alt: 'A code editor window with floating brackets',
    ratio: '4/3',
  },
  ide: {
    src: '/83bda824-6011-4b2d-8490-32b4ffaadcf7.jpg',
    alt: 'A monitor with a code editor connected to the cloud',
    ratio: '4/3',
  },
  bugShield: {
    src: '/c9a4435d-bc3e-40d9-b7e1-9794226ba1cd.jpg',
    alt: 'A shield beside a bug under a magnifying glass',
    ratio: '4/3',
  },
  settings: {
    src: '/07d1cc50-c4ca-4201-b8f2-4e98084c435f.jpg',
    alt: 'Interlocking gears with a toggle switch',
    ratio: '4/3',
  },
  teamBoard: {
    src: '/b6b53c1b-ced2-45d5-a4d9-d72cf33891b1.jpg',
    alt: 'A team gathered around a task board',
    ratio: '4/3',
  },
  timeline: {
    src: '/3a4032cb-4933-4609-ba73-1832d8d7a5dd.jpg',
    alt: 'A project timeline with milestones and a flag',
    ratio: '4/3',
  },
  workspaces: {
    src: '/57c96d06-70ad-4073-8142-f0391725e541.jpg',
    alt: 'Floating workspace platforms connected by bridges',
    ratio: '4/3',
  },
  checklist: {
    src: '/a5a3b120-9a85-4c8b-9862-c07df0961553.jpg',
    alt: 'A clipboard checklist with ticked items',
    ratio: '4/3',
  },
  integrations: {
    src: '/83404cdd-891f-488e-bf26-38a2599b34a7.jpg',
    alt: 'A hub connected to several apps by cables',
    ratio: '4/3',
  },
  assistant: {
    src: '/51477794-ab3a-4d8a-b3fe-2d7c5516edbf.jpg',
    alt: 'Task, pull request, deploy and incident records flowing into one answer',
    ratio: '21/9',
  },
  connectRepo: {
    src: '/65073e12-9dc5-474f-ac4b-941128e5e468.jpg',
    alt: 'A repository plugged into DevHQ',
    ratio: '16/9',
  },
  ship: {
    src: '/56ea080e-d1f0-4f2d-9bee-881393897234.jpg',
    alt: 'A rocket launching from a server pad',
    ratio: '4/3',
  },
  products: {
    src: '/2eb8ec2b-16eb-42a0-b4c4-930d94bb0e44.jpg',
    alt: 'Three product boxes under a shared dashboard',
    ratio: '4/3',
  },
  volunteer: {
    src: '/b41cb58f-c5af-4470-af31-7c22e679b8cd.jpg',
    alt: 'A small team passing a puzzle piece around a laptop',
    ratio: '4/3',
  },
  lockBackdrop: { src: '/d4239c83-a292-4f1a-a8a2-5d7eed335073.jpg', alt: '', ratio: '16/9' },
} as const;

export type IllustrationId = keyof typeof illustrations;
