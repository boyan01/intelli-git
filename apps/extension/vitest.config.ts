import path from 'node:path';

export default {
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['src/**/*.regression.test.ts']
    },
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, '../../packages/shared'),
            vscode: path.resolve(__dirname, 'src/test/mocks/vscode.ts')
        }
    }
};
