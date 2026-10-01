# A program that asks a question

Give a value a name, then let the person using your program choose that value.
The same instructions can produce different answers without changing a line
of the program.

## A name for a number

Load BASIC using the instructions above. This page has a fresh machine,
independent of the [first BASIC lesson](your-first-basic-program.md).

Suppose each ticket costs 2 pounds. We would like the computer to work out the
cost for different numbers of tickets. First, give the number of tickets a
name, `N`:

```basic-session
> LET N=3

OK
> PRINT N
 3

OK
```

`N` is a **variable**: a name BASIC associates with a value. `LET N=3` stores 3
under that name. It does not print the value; `PRINT N` asks to see it.
The name is not an 8080 register or a memory address we have chosen. BASIC
manages the storage for us.

Use `*` for multiplication. With three tickets at 2 pounds each:

```basic-session
> PRINT N*2
 6

OK
```

Now change the value of N. Predict the new result before printing it:

```basic-session
> LET N=5

OK
> PRINT N*2
 10

OK
```

The expression `N*2` stayed the same. It uses the value that N has when BASIC
evaluates it. Assigning a new value replaces the old one.

[Try the calculations ↑](#basic-terminal)

## Ask instead of choosing

Turn the calculation into a small stored program. Enter one numbered line at
a time, waiting for its complete echo before sending the next:

```basic-session
> 10 PRINT "HOW MANY TICKETS"
> 20 INPUT N
> 30 PRINT N*2
> 40 END
```

Line 10 prints the question. `INPUT N` on line 20 waits for a number and stores
it in N. Line 30 calculates the cost from that answer. Line 40 finishes the
program. Use LIST to check the lines:

```basic-session
> LIST

10 PRINT "HOW MANY TICKETS"
20 INPUT N
30 PRINT N*2
40 END
OK
```

Run the program. At `?`, type **3** and Enter:

```basic-session
> RUN
HOW MANY TICKETS
?
> 3
 6

OK
```

The `?` is BASIC's invitation to enter a value. It has not finished the
program and is not asking for another command. Type the number alone, not
`LET N=3`. In the terminal, your answer appears beside the question mark.
The result is 6 pounds.

While it waits for your answer, leave the browser's processor RUN control
running. The interpreter is checking for input; it needs to keep executing to
receive your number. When END returns to OK, BASIC is ready for commands again.

[Answer the question ↑](#basic-terminal)

## The same program, a different answer

Run it again and choose **5**:

```basic-session
> RUN
HOW MANY TICKETS
?
> 5
 10

OK
```

No program line changed. This time INPUT stored 5 in N, so the same calculation
produced 10 pounds. The earlier immediate assignments do not supply the answer:
each RUN reaches INPUT and waits for the person at the keyboard.

**Predict a boundary.** How much should zero tickets cost? Try it:

```basic-session
> RUN
HOW MANY TICKETS
?
> 0
 0

OK
```

We have kept this program small: it expects a whole number of tickets, zero or
more. It does not yet check whether an answer is sensible. Decisions and input
checking can come after the basic conversation is familiar.

[Try another answer ↑](#basic-terminal)

## Three different jobs

`LET` gives a variable a value chosen in an instruction. `INPUT` receives a
value from the person using the program. `PRINT` displays text or the result
of an expression. Together, they let a program accept data and do something
with it, while its instructions stay the same.
