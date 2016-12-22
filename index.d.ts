declare namespace Epub
{
    interface Chapter
    {
        title?: string;
        author?: string;
        data: string;
        excludeFromToc?: boolean;
        beforeToc?: boolean;
        filename?: string;
    }
    
    interface Options
    {
        title: string;
        author: string | string[];
        publisher?: string;
        cover?: string;
        output?: string;
        version?: 2 | 3;
        css?: "string";
        fonts?: string[];
        lang?: "en" | string;
        appendChapterTitles?: boolean;
        customOpfTemplatePath?: string;
        customNcxTocTemplatePath?: string;
        customHtmlTocTemplatePath?: string;
        content?: Chapter[];
        keywords?: string[];
    }
}

declare class Epub
{
    constructor(options: Epub.Options, output?: string);
    readonly promise: Promise<void>;
}

export = Epub;