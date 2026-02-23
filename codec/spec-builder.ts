// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';
// @ts-ignore
import { fileURLToPath } from 'url';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
// @ts-ignore
const __dirname = path.dirname(__filename);

interface MarkdownFile {
    order: number;
    title: string;
    content: string;
    path: string;
}

function parseFrontmatter(content: string): { order: number; title: string; body: string } {
    const lines = content.split('\n').map(l => l.trim());
    if (lines[0] !== '---') {
        throw new Error('No frontmatter found');
    }

    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
            endIdx = i;
            break;
        }
    }

    if (endIdx === -1) {
        throw new Error('Invalid frontmatter');
    }

    const frontmatter = lines.slice(1, endIdx).join('\n');
    const body = lines.slice(endIdx + 1).join('\n');

    const orderMatch = frontmatter.match(/order:\s*(\d+)/);
    const titleMatch = frontmatter.match(/title:\s*(.+)/);

    if (!orderMatch || !titleMatch) {
        throw new Error('Missing order or title in frontmatter');
    }

    return {
        order: parseInt(orderMatch[1]),
        title: titleMatch[1].trim(),
        body: body.trim()
    };
}

function collectMarkdownFiles(dir: string): MarkdownFile[] {
    const files: MarkdownFile[] = [];

    function walk(dirPath: string) {
        const items = fs.readdirSync(dirPath);

        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (item.endsWith('.md')) {
                const content = fs.readFileSync(fullPath, 'utf-8');
                try {
                    const { order, title, body } = parseFrontmatter(content);
                    files.push({
                        order,
                        title,
                        content: body,
                        path: fullPath
                    });
                } catch (e) {
                    console.warn(`Skipping ${fullPath}: ${(e as Error).message}`);
                }
            }
        }
    }

    walk(dir);
    return files;
}

function generateSpecification(files: MarkdownFile[]): string {
    // Sort by order
    files.sort((a, b) => a.order - b.order);

    const spec = [
        '# Pixel Exchange Format (PXF) Specification',
        '',
        'Version 300 - Normative Technical Specification',
        '',
        'This document provides a complete technical specification for the Pixel Exchange Format (PXF) version 300, enabling clean-room implementation of encoders and decoders.',
        '',
        '---',
        ''
    ];

    for (const file of files) {
        spec.push(`## ${file.title}`, '');
        spec.push(file.content);
        spec.push('', '---', '');
    }

    return spec.join('\n');
}

function main() {
    const srcDir = path.join(__dirname, 'src');
    const outputFile = path.join(__dirname, 'SPECIFICATION.md');

    console.log('Collecting Markdown files...');
    const files = collectMarkdownFiles(srcDir);

    console.log(`Found ${files.length} Markdown files`);
    files.forEach(f => console.log(`  ${f.order}: ${f.title} (${f.path})`));

    console.log('Generating specification...');
    const spec = generateSpecification(files);

    console.log('Writing SPECIFICATION.md...');
    fs.writeFileSync(outputFile, spec, 'utf-8');

    console.log('Specification generated successfully!');
}

main();
