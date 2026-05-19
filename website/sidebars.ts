import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'README',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/quickstart',
        'getting-started/api-keys',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/privacy-and-security',
        'concepts/production-readiness',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: [
        'integrations/zkp-biometric-auth',
        'integrations/saml-sso',
        'integrations/oidc',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'operations/deployment',
        'operations/admin-dashboard',
        'operations/central-api-delivery-plan',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/central-api',
        'reference/api-reference',
        'reference/playground',
        'reference/environment-variables',
        'reference/contracts-and-circuit',
      ],
    },
  ],
};

export default sidebars;
