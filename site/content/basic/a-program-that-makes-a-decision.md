# A program that makes a decision

Let a program choose what to do with an answer. Compare the number of tickets
with zero, follow a different path when there are none, and catch a negative
answer before calculating a price.

## Start with the question

Load or resume BASIC using the instructions above, and begin at OK. If you
continued directly from [the previous lesson](a-program-that-asks-a-question.md),
keep its four-line ticket program and skip the setup block below. Each ticket
costs 2 pounds; N holds the number of tickets.

If you are starting here or returning from a different lesson, type NEW to
clear the stored program and variables, then enter these four lines.

Type one numbered line at a time, pressing Enter and waiting for the complete
echo before sending the next:

```basic-session
> NEW

OK
> 10 PRINT "HOW MANY TICKETS"
> 20 INPUT N
> 30 PRINT N*2
> 40 END
```

So far, every answer takes the same route: ask, receive, calculate, finish.
We would like zero tickets to produce the message NO TICKETS instead of a price.

## Ask a yes-or-no question

Add these three lines:

```basic-session
> 25 IF N=0 THEN 60
> 60 PRINT "NO TICKETS"
> 70 END
```

Read line 25 as “if N equals zero, go to line 60.” The comparison `N=0` is a
**condition**: it can be true or false. When it is true, BASIC continues at
line 60. When it is false, BASIC continues at the next stored line, 30.

Here `=` tests a value. It does not change N. In an assignment such as
`LET N=0`, it gives N a new value; `IF N=0` asks whether the value already
there is zero.

The 60 after THEN is a line number to go to, not a value to print. We inserted
line 25 between 20 and 30 without having to renumber either of them. LIST shows
the result in line-number order:

```basic-session
> LIST

10 PRINT "HOW MANY TICKETS"
20 INPUT N
25 IF N=0 THEN 60
30 PRINT N*2
40 END
60 PRINT "NO TICKETS"
70 END
OK
```

[Add the decision ↑](#basic-terminal)

## Try both paths

RUN the program and answer **0** at the question mark:

```basic-session
> RUN
HOW MANY TICKETS
?
> 0
NO TICKETS

OK
```

The condition is true. BASIC goes straight from line 25 to line 60, prints the
message, and finishes at line 70. Lines 30 and 40 are passed over.

Now RUN again and answer **3**:

```basic-session
> RUN
HOW MANY TICKETS
?
> 3
 6

OK
```

The condition is false. BASIC continues from line 25 to line 30, calculates
6 pounds, and finishes at line 40. It never reaches the NO TICKETS message.

| Answer | Is N equal to zero? | Lines followed after INPUT |
| --- | --- | --- |
| 0 | Yes | 25 → 60 → 70 |
| 3 | No | 25 → 30 → 40 |

**Why keep END on line 40?** It finishes the price path before the message on
line 60. A line number such as 60 gives us somewhere to go; it does not make
that line run only when chosen by IF. Execution can also reach a line by
continuing from the one before it.

Both paths belong to the same stored program. Each RUN asks for a new answer,
and that answer decides which path is taken. Leave the browser's processor
RUN control running while BASIC waits for input or returns to OK.

[Try the two answers ↑](#basic-terminal)

## Catch an impossible answer

Zero tickets makes sense. Minus one ticket does not. Our program would still
multiply a negative answer by 2, so add a check before either existing path:

```basic-session
> 22 IF N<0 THEN 80
> 80 PRINT "PLEASE USE ZERO OR MORE"
> 90 END
```

The sign `<` means **less than**. Line 22 asks whether N is below zero. If so,
it goes to line 80, prints our explanation, and finishes at line 90. Otherwise
it continues to line 25 and the zero check we already wrote.

Notice that 22 belongs between INPUT on line 20 and the earlier decision on
line 25. LIST now shows the complete program:

```basic-session
> LIST

10 PRINT "HOW MANY TICKETS"
20 INPUT N
22 IF N<0 THEN 80
25 IF N=0 THEN 60
30 PRINT N*2
40 END
60 PRINT "NO TICKETS"
70 END
80 PRINT "PLEASE USE ZERO OR MORE"
90 END
OK
```

RUN and answer **-1**:

```basic-session
> RUN
HOW MANY TICKETS
?
> -1
PLEASE USE ZERO OR MORE

OK
```

This is a message we wrote, not a BASIC error. The program finishes without
printing a price. It does not ask again automatically; type RUN for another try.

## Check the boundary again

After changing a program, check the paths that already worked as well as the
new one. **Predict the replies for 0 and 1.** Neither is less than zero, but
only one is equal to zero.

```basic-session
> RUN
HOW MANY TICKETS
?
> 0
NO TICKETS

OK
> RUN
HOW MANY TICKETS
?
> 1
 2

OK
```

We have tried a number just below zero, zero itself, and a number just above
zero. These answers exercise all three paths:

| Answer | Lines followed after INPUT | Result |
| --- | --- | --- |
| -1 | 22 → 80 → 90 | Explain that the number must be zero or more. |
| 0 | 22 → 25 → 60 → 70 | Say there are no tickets. |
| 1 | 22 → 25 → 30 → 40 | Print the price, 2 pounds. |

We still expect whole numbers of tickets. This check rejects negative numbers;
it does not reject a fraction such as 1.5. The program can only check the rules
we have given it.

In the [next lesson](a-program-that-asks-again.md), we will make the program
ask again after an unsuitable answer, then let it calculate several prices
in one run.

[Check all three paths ↑](#basic-terminal)

The original [Altair BASIC manual](https://altairclone.com/downloads/manuals/BASIC%20Manual%2075.pdf){:target="_blank" rel="noopener"}
describes comparisons on printed page 28 and IF…THEN on printed page 33.
