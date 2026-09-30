import type {Metadata} from 'next';
import './globals.css';
import './import.css';
import './updates.css';
export const metadata:Metadata={title:'Петелька — моя мастерская',description:'Проекты вязания, время работы и ваша коллекция пряжи.'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="ru"><body>{children}</body></html>;
}
