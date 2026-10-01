# Your first BASIC program

Type a calculation and see the answer. Then ask the computer to remember a few
instructions and carry them out together. You can start here without knowing
any 8080 instructions.

## An answer now

Once BASIC is ready, click **Terminal keyboard**, type this command in uppercase,
then press Enter:

```basic-session
> PRINT 2+3
 5

OK
```

The spaces around the answer are normal. Here, `PRINT` means “send the result
to the terminal.” This is an **immediate command**: BASIC does the calculation
as soon as you submit the line. `OK` means it is ready for another command.
The examples separate what you type from BASIC's reply; the terminal also
echoes your input.

**Try another sum.** Predict the result before entering this command:

```basic-session
> PRINT 2+8
 10

OK
```

[Try it in the terminal ↑](#basic-terminal)

## Instructions for later

At OK, type NEW to clear any program left from another lesson. Then type these
three lines, pressing Enter after each one. If you paste, paste
**one line at a time**. Wait until the complete line has appeared in the
terminal before sending the next.

```basic-session
> NEW

OK
> 10 PRINT "HELLO"
> 20 PRINT 2+3
> 30 END
```

Each line begins with a **line number**. That tells BASIC to store the
instruction for later. You see the line echoed, but you do not get HELLO,
the answer 5, or a new OK yet. That is expected.

The line numbers are decimal labels, not memory addresses. BASIC uses their
order to decide which instruction comes next. We have left gaps between them
so there is room to insert another line later.

Quotation marks make `"HELLO"` a piece of text to print. Without quotation
marks, `2+3` is a calculation. `END` marks the end of our program.

**Made a typing mistake?** Before Enter, Backspace erases one character. BASIC
echoes an underscore rather than rubbing the old character off the display.
After Enter, type the whole numbered line again correctly: BASIC replaces the
line with that number. If an immediate command produces an error, wait for OK
and type it again.

**Think about it.** Why did `PRINT 2+3` give an answer earlier, while
`20 PRINT 2+3` did not? The leading 20 asks BASIC to remember the instruction.
It has not been asked to run the stored program yet.

[Enter the program ↑](#basic-terminal)

## Look, then run

Type `LIST` and Enter. BASIC prints the stored lines in line-number order,
then OK. Check your program against this listing:

```basic-session
> LIST

10 PRINT "HELLO"
20 PRINT 2+3
30 END
OK
```

LIST shows what BASIC remembers; it does not execute those instructions.
Now type `RUN` and Enter:

```basic-session
> RUN
HELLO
 5

OK
```

BASIC starts at the lowest line number. Line 10 prints the greeting, line 20
prints the sum, and line 30 returns control to BASIC. Run it again: the program
is still there, so it produces the same result.

```basic-session
> RUN
HELLO
 5

OK
```

The typed BASIC command `RUN` starts your stored program. The browser's **RUN**
button lets the processor execute instructions. Leave that processor running
even at OK: BASIC needs it to receive your next command. `END` finishes your
BASIC program without stopping the processor.

[List and run ↑](#basic-terminal)

## Change one line

Enter this replacement, then LIST:

```basic-session
> 20 PRINT 2+8
> LIST

10 PRINT "HELLO"
20 PRINT 2+8
30 END
OK
```

There are still three lines, with just one line numbered 20. Its calculation
now reads `2+8`; the greeting and END are unchanged. Run it:

```basic-session
> RUN
HELLO
 10

OK
```

Replacing one stored instruction changed what the program does.

**Make it yours.** Replace line 10, then predict the whole output before RUN:

```basic-session
> 10 PRINT "HI"
> RUN
HI
 10

OK
```

Changing line 10 leaves line 20 alone.

[Change your program ↑](#basic-terminal)

## A program running a program

Earlier lessons followed individual 8080 instructions. Here those same kinds
of instructions run BASIC: they read characters, store your lines, calculate,
and print. Your BASIC program gives the interpreter work to do.
