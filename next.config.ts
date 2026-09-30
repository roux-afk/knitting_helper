import type { NextConfig } from 'next';
const config: NextConfig = { output:'standalone',devIndicators: false, poweredByHeader: false,
 outputFileTracingExcludes:{'/*':['./data/**/*','./desktop/**/*','./dist/**/*','./tests/**/*','./docs/**/*','./.env*']},
 outputFileTracingIncludes:{'/*':['./node_modules/next/dist/compiled/next-server/**/*']},
};
export default config;
