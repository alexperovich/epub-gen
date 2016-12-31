export interface Chapter {
    title?: string;
    author?: string | string[];
    data: string;
    excludeFromToc?: boolean;
    beforeToc?: boolean;
    filename?: string;
    url?: string;
}
export interface Options {
    title: string;
    author: string | string[];
    publisher?: string;
    cover?: string;
    output?: string;
    version?: 2 | 3;
    css?: string;
    fonts?: string[];
    lang?: "en" | string;
    appendChapterTitles?: boolean;
    customOpfTemplatePath?: string;
    customNcxTocTemplatePath?: string;
    customHtmlTocTemplatePath?: string;
    content?: Chapter[];
    keywords?: string[];
    source?: string;
}
export interface IHost {
    downloadFile(url: string, path: string): Promise<void>;
}
export default class EPub {
    private readonly host;
    private readonly options;
    private id;
    private uuid;
    promise: Promise<void>;
    constructor(options: Options, output?: string, host?: IHost);
    private render();
    private generateTempFile();
    private makeCover();
    private downloadAllImages();
    private downloadImage(image);
    private genEpub();
}
