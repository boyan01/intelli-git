import path from 'node:path';

export default {
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, '../../packages/shared'),
            '@': path.resolve(__dirname, 'src'),
        },
    },
};
