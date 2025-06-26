'use client'

import {useState, useEffect, useRef} from 'react'
import {
    Terminal,
    Code,
    Briefcase,
    Mail,
    User,
    Cpu,
    Calculator,
    Music,
    Github,
    Linkedin,
    TerminalIcon, Minimize2, X
} from 'lucide-react'
import {motion, AnimatePresence} from 'framer-motion'
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Textarea} from "@/components/ui/textarea"
import {Card, CardContent} from "@/components/ui/card"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip"

export default function Profile() {
    const [activeSection, setActiveSection] = useState('home')
    const [terminalInput, setTerminalInput] = useState('')
    const [terminalOutput, setTerminalOutput] = useState(['Welcome to my profile. Type "help" for commands.'])
    const [easterEggCount, setEasterEggCount] = useState(0)
    const [mathProblem, setMathProblem] = useState({question: '', answer: 0})
    const [musicPlaying, setMusicPlaying] = useState(false)
    const terminalRef = useRef(null)
    const audioRef = useRef(null)

    const skills = [
        {name: 'JavaScript', description: 'Expert in ES6+, async programming, and functional concepts'},
        {name: 'Python', description: 'Proficient in data analysis, machine learning, and web scraping'},
        {name: 'React', description: 'Experienced in building complex, state-driven applications'},
        {name: 'Node.js', description: 'Skilled in creating RESTful APIs and real-time applications'},
        {name: 'SQL', description: 'Proficient in database design, optimization, and complex queries'},
        {
            name: 'Git',
            description: 'Experienced in version control, branching strategies, and collaborative development'
        },
    ]

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight
        }
    }, [terminalOutput])

    useEffect(() => {
        generateMathProblem()
    }, [])

    const generateMathProblem2 = () => {
        const num1 = Math.floor(Math.random() * 10) + 1
        const num2 = Math.floor(Math.random() * 10) + 1
        const operator = ['+', '-', '*'][Math.floor(Math.random() * 3)]
        let question = `${num1} ${operator} ${num2}`
        let answer = eval(question)
        setMathProblem({question, answer})
    }
    const generateMathProblem = () => {
        const problems = [
            {
                question: "Find the x gradient of the function f(x, y) = x^3y - e^x sin(y) at the point (1, π/2). Round to two decimal places.",
                answer: 1.99
            },
            {
                question: "Compute the value of the double integral ∫∫(2x + 3y) dy dx from 0 to 1.",
                answer: 2.5
            },
            {
                question: "Find the sum of the eigenvalues of the matrix A = [[2, 1], [1, 2]].",
                answer: 4
            },
            {
                question: "For the differential equation dy/dx = 2y, solve it with y(0) = 1 and find y(1).",
                answer: 7.389
            },
            {
                question: "Compute the determinant of the matrix B = [[4, 1], [2, 3]].",
                answer: 10
            },
            {
                question: "Compute the partial derivative of f(x, y) = ln(x^2 + y^2) with respect to x at the point (2, 3).",
                answer: 0.3076923076923077
            },
            {
                question: "Find the trace of the matrix C = [[1, 0, 0], [0, 2, 0], [0, 0, 3]].",
                answer: 6
            }
        ];

        setMathProblem(problems[Math.floor(Math.random() * problems.length)]);
    }

    const handleTerminalSubmit = (e: { preventDefault: () => void }) => {
        e.preventDefault()
        const input = terminalInput.toLowerCase().trim()
        setTerminalOutput([...terminalOutput, `> ${input}`])

        switch (input) {
            case 'help':
                setTerminalOutput(prev => [...prev, 'Available commands: about, skills, projects, contact, clear, math'])
                break
            case 'about':
                const output = 'About Me\nTexas A&M University\nDual Major: Computer Science & Physics\nScholarships: $103,500 awarded, including the prestigious Brown Scholar\nand National Merit Scholar distinctions.\n\nFounder & Chief Engineer at LindauerAI, LLC\nFounded LindauerAI to explore advancements in AI, particularly focusing on LLMs,\nReinforcement Learning, and Vector Search. Currently leading development on an educational AI service,\nwhich includes LLM training, prompt engineering, and custom performance benchmarks.\n\nMachine Learning Intern at DataStax, Inc.\nTwice interned at DataStax, focusing on vector search technologies and GPU-accelerated search techniques,\nusing tools like CUDA and Lucene/JVector.\n\nPatents\nI\'ve developed patented systems to improve machine learning training and enhance educational interactions through AI.\nThese innovations streamline computational efficiency and foster deeper learning experiences.\n\nTechnologies & Tools\nProgramming Languages\nPython, Java, CQL\n\nAI/ML\nMachine Learning (ML), Artificial Intelligence (AI), Natural Language Processing (NLP), Vector Search, LLMs,\nBERT Classifiers, Reinforcement Learning\n\nDatabases & Cloud\nPostgreSQL, AstraDB, Google Cloud Platform (GCP)\n\nFrameworks\nPyTorch, Cloud Run, Retrieval Augmented Generation (RAG)\n\nProjects & Research\nLindauerAI\nBuilt an AI platform that integrates LLMs with educational services. Developed backend authentication,\nsession management, and vector database schemas, leveraging Google APIs and Datastax AstraDB.\n\nRoboMasters CV Team\nAs part of the TAMU RoboMasters team, I specialize in computer vision technologies for automated robotic control.\n\nResearch with Professor Shell\nContributed to enhancing DFA/POMDP algorithms for intelligent robotic planning.'
                setTerminalOutput(prev => [...prev, output])
                break
            case 'skills':
                break
            case 'projects':
                break
            case 'clear':
                setTerminalOutput([])
                break
            case 'sudo kavin':
                setTerminalOutput(prev => [...prev, 'Kavin is awesome'])
                window.location.href = 'https://toptobes.github.io/portfolio/'

                setEasterEggCount(prev => prev + 1)
                break
            case 'music':
                toggleMusic()
                break
            case 'math':
                setTerminalOutput(prev => [...prev, `Math problem: ${mathProblem.question} = ?`])
                break
            default:
                if (input.startsWith('solve ')) {
                    const userAnswer = parseFloat(input.split(' ')[1])
                    if (userAnswer === mathProblem.answer) {
                        setTerminalOutput(prev => [...prev, 'Correct! You\'re a math wizard!'])
                        generateMathProblem()
                    } else {
                        setTerminalOutput(prev => [...prev, `Sorry, that's incorrect. The correct answer is ${mathProblem.answer}.`])
                    }
                } else {
                    setTerminalOutput(prev => [...prev, 'Command not recognized. Type "help" for available commands.'])
                }
        }

        setTerminalInput('')
    }

    const toggleMusic = () => {
        if (musicPlaying) {
            audioRef.current.pause()
            setMusicPlaying(false)
            setTerminalOutput(prev => [...prev, 'Music paused.'])
        } else {
            audioRef.current.play()
            setMusicPlaying(true)
            setTerminalOutput(prev => [...prev, 'Playing some coding beats!'])
        }
    }

    const SkillTree = () => (
        <div className="flex flex-wrap justify-center gap-4">
            {['Python', 'SQL', 'Java', 'CQL', 'AI/ML', 'Vector Search', 'RAG', 'Reinforcement Learning', 'NLP', 'PyTorch', 'GCP', 'LLMs'].map((skill, index) => (
                <Card key={skill}
                      className="w-32 h-32 flex items-center justify-center transform transition-all hover:scale-110 hover:rotate-3">
                    <CardContent>
                        <Cpu className="w-8 h-8 mb-2 mx-auto"/>
                        <p className="text-center">{skill}</p>
                    </CardContent>
                </Card>
            ))}
        </div>
    )


    const ProjectShowcase = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
                {
                    name: 'LindauerAI',
                    desc: 'Built an AI platform that integrates LLMs with educational services. Developed backend authentication, session management, and vector database schemas, leveraging Google APIs and Datastax AstraDB.'
                },
                {
                    name: 'Planning to Chronicle Cost-based Algorithm',
                    desc: 'Contributed to enhancing DFA/POMDP algorithms for intelligent robotic planning.'
                },
                {
                    name: 'RoboMasters CV Team',
                    desc: 'As part of the TAMU RoboMasters team, I specialize in computer vision technologies for automated robotic control.'
                },
                {name: '3D Chess', desc: 'A true 3D chess cube in the browser, built with Three.js and React.'},

            ].map((project, index) => (
                <motion.div
                    key={project.name}
                    initial={{opacity: 0, scale: 0.9}}
                    animate={{opacity: 1, scale: 1}}
                    transition={{duration: 0.5, delay: index * 0.1}}
                >
                    <Card className="h-full transform transition-all hover:scale-105 hover:rotate-1">
                        <CardContent className="p-4">
                            <h3 className="text-lg font-semibold mb-2">{project.name}</h3>
                            <p className="text-muted-foreground">{project.desc}</p>
                        </CardContent>
                    </Card>
                </motion.div>
            ))}
        </div>
    )

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-8">
            <div className="max-w-4xl mx-auto">
                <motion.header
                    className="text-center mb-12"
                    initial={{opacity: 0, y: -20}}
                    animate={{opacity: 1, y: 0}}
                    transition={{duration: 0.5}}
                >
                    <motion.h1
                        className="text-6xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600"
                        initial={{scale: 0.5}}
                        animate={{scale: 1}}
                        transition={{duration: 0.5, delay: 0.5}}
                    >
                        Tiernan Lindauer
                    </motion.h1>
                    <motion.p
                        className="text-xl"
                        initial={{opacity: 0}}
                        animate={{opacity: 1}}
                        transition={{duration: 0.5, delay: 0.8}}
                    >
                        TAMU CS + Physics '27 | AI Researcher + Entrepreneur
                    </motion.p>
                    <div className="mt-4 flex justify-center space-x-4">
                        <a href="https://github.com/T-Lind" target="_blank" rel="noopener noreferrer">
                            <Github className="w-6 h-6 hover:text-blue-400 transition-colors"/>
                        </a>
                        <a href="https://www.linkedin.com/in/tiernan-lindauer-746922247" target="_blank"
                           rel="noopener noreferrer">
                            <Linkedin className="w-6 h-6 hover:text-blue-400 transition-colors"/>
                        </a>
                    </div>
                </motion.header>
                <div className="flex items-center justify-center">
                    <motion.div
                        className="bg-gray-900 rounded-lg shadow-lg overflow-hidden w-full max-w-2xl"
                        initial={{opacity: 0, y: 20}}
                        animate={{opacity: 1, y: 0}}
                        transition={{duration: 0.5}}
                    >
                        <div className="flex items-center justify-between bg-gray-800 px-4 py-2">
                            <div className="flex items-center space-x-2">
                                <TerminalIcon size={18} className="text-gray-400"/>
                                <span className="text-sm font-medium text-gray-300">Terminal</span>
                            </div>
                            <div className="flex space-x-2">
                                <button className="text-gray-400 hover:text-gray-200">
                                    <Minimize2 size={18}/>
                                </button>
                                <button className="text-gray-400 hover:text-gray-200">
                                    <X size={18}/>
                                </button>
                            </div>
                        </div>
                        <div className="p-4 font-mono text-sm">
                            <div ref={terminalRef} className="h-64 overflow-y-auto mb-2 space-y-1">
                                {terminalOutput.map((line, index) => (
                                    <div key={index} className="flex">
                                        <span className="text-gray-600 w-8">{index + 1}</span>
                                        <span className="text-gray-300">{line}</span>
                                    </div>
                                ))}
                            </div>
                            <form onSubmit={handleTerminalSubmit} className="flex items-center">
                                <span className="text-green-400 mr-2">$</span>
                                <input
                                    type="text"
                                    value={terminalInput}
                                    onChange={(e) => setTerminalInput(e.target.value)}
                                    className="flex-grow bg-transparent border-none text-white focus:outline-none"
                                    placeholder="Type a command..."
                                />
                                <span className="animate-pulse text-white ml-1">▋</span>
                            </form>
                        </div>
                    </motion.div>
                </div>
            </div>
        </div>
    )
}
